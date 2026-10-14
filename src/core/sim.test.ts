import { describe, expect, it } from 'vitest';
import {
  BASE_MAX_QI,
  derive,
  effectiveStats,
  MAX_QI_PER_SPIRIT,
  PATHS,
  QI_BASE_REGEN,
  QI_PER_SPIRIT,
  readyForTribulation,
  xpToNext,
  type PathId,
} from './cultivator.ts';
import {
  ENEMY_MAX_QI,
  makeEnemy,
  makeTribulation,
  TRIBULATIONS,
  type EnemyKind,
} from './floors.ts';
import {
  arrayValue,
  equippedArray,
  itemAffixValue,
  namesFor,
  slotsFor,
  SOUL_CAPS,
  soulCap,
  soulDamage,
  type ArrayId,
  type GradeId,
  type Item,
} from './loot.ts';
import { INVENTORY_SIZE, sellPrice } from './economy.ts';
import {
  ARRAY_TICK,
  canEquip,
  canFaceTribulation,
  characterStatus,
  ENEMY_ARRIVAL,
  ENEMY_QI_PER_ATTACK,
  ENEMY_QI_REGEN,
  equip,
  faceTribulation,
  mitigate,
  newGame,
  QI_PER_ATTACK,
  QI_PER_HIT_TAKEN,
  QI_TICK,
  requiredRealm,
  restartFloor,
  retire,
  setAutoTribulation,
  tick,
  TRIAL_LOSS_LIMIT,
  TRIAL_RETRY_SECONDS,
  TRIAL_STRONGER,
  trialRetryDue,
  trialRetryIn,
  trialSetAside,
  unequip,
  type GameState,
  type TickOptions,
} from './sim.ts';

/**
 * Per-test time limit for the long simulations below (hours of sim time, or
 * 64 seeds per Path). They take a few seconds, close to the 5 s default, so a
 * loaded machine could time them out; the limit is raised, the work is not cut.
 */
const LONG_SIM_MS = 30_000;

const PATH_IDS = Object.keys(PATHS) as PathId[];

function run(state: GameState, seconds: number, step: number, opts: TickOptions = {}): GameState {
  const steps = Math.round(seconds / step);
  for (let i = 0; i < steps; i++) state = tick(state, step, opts);
  return state;
}

describe('determinism', () => {
  it.each(PATH_IDS)('replays %s the same from the same seed', (path) => {
    expect(run(newGame(42, path), 600, 1)).toEqual(run(newGame(42, path), 600, 1));
  });

  it('plays differently from a different seed', () => {
    expect(run(newGame(1, 'sword'), 600, 1)).not.toEqual(run(newGame(2, 'sword'), 600, 1));
  });
});

describe('tick', () => {
  it.each(PATH_IDS)(
    'gives %s the same result for one big step as many small ones',
    (path) => {
      const start = newGame(7, path);
      const big = tick(start, 3600);
      const small = run(start, 3600, 1);
      expect(big).toEqual(small);
      // A fractional step lands on the same events too.
      expect(run(start, 3600, 0.25)).toEqual(big);
    },
    LONG_SIM_MS,
  );

  it(
    'matches one big step within tolerance for a step that is not exact in binary',
    () => {
      const start = newGame(7, 'sword');
      const big = tick(start, 3600);
      const small = run(start, 3600, 0.1);
      // Summing 0.1s drifts the clock by a hair; every event still lands the
      // same. The qi step due at exactly 3600 s can fall a hair past the
      // drifted end, so both settle half a second more before comparing.
      expect(small.time).toBeCloseTo(big.time, 6);
      const settle = (s: GameState) => ({ ...tick(s, 0.5), time: 0 });
      expect(settle(small)).toEqual(settle(big));
    },
    LONG_SIM_MS,
  );

  it('resumes from a saved copy exactly as if it never stopped', () => {
    const half = run(newGame(4, 'talisman'), 600, 1);
    const saved = JSON.parse(JSON.stringify(half)) as GameState;
    expect(tick(saved, 600)).toEqual(tick(half, 600));
  });

  it('leaves the input state untouched', () => {
    const start = newGame(3, 'body');
    const copy = structuredClone(start);
    tick(start, 120);
    expect(start).toEqual(copy);
  });

  it('changes nothing for dt 0', () => {
    const start = newGame(3, 'body');
    expect(tick(start, 0)).toEqual(start);
  });

  it('rejects negative, NaN and infinite dt', () => {
    const start = newGame(3, 'body');
    for (const dt of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => tick(start, dt)).toThrow(RangeError);
    }
  });
});

describe('floors', () => {
  it.each(PATH_IDS)('lets a fresh %s clear floor 1', (path) => {
    const s = run(newGame(11, path), 120, 1);
    expect(s.highestFloor).toBeGreaterThan(1);
  });

  it.each(PATH_IDS)('drops %s back one floor on a loss to a regular enemy', (path) => {
    let s = until(newGame(5, path), (x) => x.floor === 3);
    for (const e of s.enemies) e.damage = 1e9;
    const { deaths } = s;
    s = until(s, (x) => x.deaths > deaths);
    expect(s.floor).toBe(2);
    expect(s.highestFloor).toBe(3);
    expect(s.cultivator.hp).toBe(derive(s.cultivator).maxHp);
  });

  it('never drops below floor 1', () => {
    let s = newGame(1, 'sword');
    for (const e of s.enemies) e.damage = 1e9;
    while (s.deaths === 0 && s.time < 120) s = tick(s, 1);
    expect(s.deaths).toBe(1);
    expect(s.floor).toBe(1);
  });

  it('starts each floor with full HP and a full enemy line-up', () => {
    let s = newGame(8, 'body');
    while (s.highestFloor < 3) s = tick(s, 1);
    expect(s.enemies[0]?.hp).toBe(s.enemies[0]?.maxHp);
  });
});

describe('enemy arrival', () => {
  /** Ticks in small steps until `done`, returning the state at that step. */
  function until(state: GameState, done: (s: GameState) => boolean): GameState {
    for (let i = 0; i < 100_000 && !done(state); i++) state = tick(state, 0.01);
    expect(done(state)).toBe(true);
    return state;
  }

  it('pauses both sides after a kill, then the next enemy fights', () => {
    const start = newGame(5, 'sword');
    const s = until(start, (x) => x.kills > start.kills);
    const killedAt = s.time;
    expect(s.cultivator.nextAttackAt).toBeGreaterThan(killedAt + ENEMY_ARRIVAL - 0.01);
    expect(s.enemyNextAttackAt).toBeGreaterThan(killedAt + ENEMY_ARRIVAL - 0.01);
    // Nothing happens during the pause.
    const paused = tick(s, ENEMY_ARRIVAL - 0.02);
    expect(paused.enemies).toEqual(s.enemies);
    expect(paused.cultivator.hp).toBe(s.cultivator.hp);
    expect(paused.cultivator.attackCount).toBe(s.cultivator.attackCount);
  });

  it('pauses both sides after a loss too', () => {
    let s = newGame(5, 'sword');
    s.cultivator.hp = 1;
    s = until(s, (x) => x.deaths > 0);
    expect(s.cultivator.nextAttackAt).toBeGreaterThan(s.time + ENEMY_ARRIVAL - 0.01);
    expect(s.enemyNextAttackAt).toBeGreaterThan(s.time + ENEMY_ARRIVAL - 0.01);
  });

  it('starts a new game with no pause', () => {
    const s = newGame(5, 'sword');
    expect(s.cultivator.nextAttackAt).toBe(derive(s.cultivator).attackInterval);
  });
});

describe('mitigate', () => {
  it('passes damage through at 0 defence and halves it at 50', () => {
    expect(mitigate(10, 0)).toBe(10);
    expect(mitigate(10, 50)).toBe(5);
  });

  it('never deals less than 1', () => {
    expect(mitigate(1, 1e6)).toBe(1);
  });
});

function weapon(level: number, baseRoll: number): Item {
  return {
    slot: 'weapon',
    name: 'Iron Flying Sword',
    level,
    grade: 'mortal',
    baseRoll,
    affixes: [],
  };
}

function withBag(state: GameState, items: Item[]): GameState {
  return { ...structuredClone(state), inventory: items };
}

describe('drops', () => {
  it(
    'picks up drops at the item level of the floor they fell on',
    () => {
      // Steps short enough for one kill each, through deaths that drop a floor.
      let s = newGame(21, 'talisman');
      let checked = 0;
      let afterDeath = 0;
      while (s.time < 3600 && s.inventory.length < INVENTORY_SIZE) {
        const before = s;
        s = tick(s, 0.05);
        for (const item of s.inventory.slice(before.inventory.length)) {
          expect(item.level).toBe(before.floor);
          checked++;
          if (before.floor < before.highestFloor) afterDeath++;
        }
      }
      expect(checked).toBeGreaterThan(10);
      expect(afterDeath).toBeGreaterThan(0);
    },
    LONG_SIM_MS,
  );

  it('sells overflow when the bag is full instead of losing it', () => {
    const full = withBag(
      newGame(21, 'sword'),
      Array.from({ length: INVENTORY_SIZE }, () => weapon(1, 0)),
    );
    const s = tick(full, 1800);
    const open = tick(newGame(21, 'sword'), 1800);
    expect(s.inventory).toEqual(full.inventory);
    expect(s.dropsSold).toBeGreaterThan(0);
    expect(s.dropsSalvaged).toBe(0);
    // Same seed, same fights: every drop the open bag kept, the full bag sold.
    expect(s.dropsSold).toBe(open.inventory.length + open.dropsSold);
    const prices = open.inventory.reduce((n, i) => n + sellPrice(i), 0);
    expect(s.stones - open.stones).toBe(prices);
  });

  it('pays Spirit Stones for every kill', () => {
    const s = tick(newGame(21, 'sword'), 600);
    expect(s.kills).toBeGreaterThan(0);
    expect(s.stones).toBeGreaterThanOrEqual(s.kills);
  });
});

describe('equip', () => {
  it('moves the item into its slot and the old one back into the bag', () => {
    const first = equip(withBag(newGame(1, 'sword'), [weapon(5, 0), weapon(9, 1)]), 0);
    expect(first.cultivator.equipment.weapon).toEqual(weapon(5, 0));
    expect(first.inventory).toEqual([weapon(9, 1)]);
    const second = equip(first, 0);
    expect(second.cultivator.equipment.weapon).toEqual(weapon(9, 1));
    expect(second.inventory).toEqual([weapon(5, 0)]);
  });

  it('leaves the input state untouched', () => {
    const start = withBag(newGame(1, 'sword'), [weapon(5, 0)]);
    const copy = structuredClone(start);
    equip(start, 0);
    expect(start).toEqual(copy);
  });

  it('rejects an index with no item', () => {
    const start = withBag(newGame(1, 'sword'), [weapon(5, 0)]);
    for (const i of [-1, 1, 0.5, Number.NaN]) expect(() => equip(start, i)).toThrow(RangeError);
  });

  it('fills the free one of two positions first, then replaces the first', () => {
    const ring = (level: number): Item => ({ ...weapon(level, 0), slot: 'accessory' });
    let s = withBag(newGame(1, 'sword'), [ring(1), ring(2), ring(3)]);
    s = equip(s, 0);
    expect(s.cultivator.equipment.accessory1).toEqual(ring(1));
    s = equip(s, 0);
    expect(s.cultivator.equipment.accessory2).toEqual(ring(2));
    s = equip(s, 0);
    expect(s.cultivator.equipment.accessory1).toEqual(ring(3));
    expect(s.cultivator.equipment.accessory2).toEqual(ring(2));
    expect(s.inventory).toEqual([ring(1)]);
  });

  it('equips into a chosen position, swapping out what was there', () => {
    const charm = (level: number): Item => ({ ...weapon(level, 0), slot: 'charm' });
    let s = withBag(newGame(1, 'sword'), [charm(1), charm(2)]);
    s = equip(s, 0, 'charm2');
    expect(s.cultivator.equipment).toEqual({ charm2: charm(1) });
    s = equip(s, 0, 'charm2');
    expect(s.cultivator.equipment).toEqual({ charm2: charm(2) });
    expect(s.inventory).toEqual([charm(1)]);
  });

  it('rejects a position the item does not fit', () => {
    const start = withBag(newGame(1, 'sword'), [weapon(5, 0)]);
    expect(() => equip(start, 0, 'charm1')).toThrow(RangeError);
  });

  it('shares no objects between the old and new state, on a swap too', () => {
    const start = equip(withBag(newGame(1, 'sword'), [weapon(5, 0), weapon(9, 1)]), 0);
    const s = equip(start, 0);
    expect(s.cultivator.equipment.weapon).not.toBe(start.inventory[0]);
    expect(s.inventory[0]).not.toBe(start.cultivator.equipment.weapon);
    expect(s.inventory[0]).toEqual(start.cultivator.equipment.weapon);
  });

  it('never leaves HP above a lower max HP', () => {
    const pendant: Item = {
      slot: 'accessory',
      name: 'Bone Bead Pendant',
      level: 50,
      grade: 'mortal',
      baseRoll: 1,
      affixes: [],
    };
    let s = equip(withBag(newGame(1, 'body'), [pendant]), 0);
    s.cultivator.hp = derive(s.cultivator).maxHp;
    // Into the same position, so the weaker item replaces the stronger one.
    s = equip({ ...s, inventory: [{ ...pendant, level: 1 }] }, 0, 'accessory1');
    expect(s.cultivator.hp).toBe(derive(s.cultivator).maxHp);
  });

  it.each(PATH_IDS)('makes %s measurably stronger with a better weapon', (path) => {
    const start = newGame(13, path);
    const bare = start.cultivator;
    const armed = equip(withBag(start, [weapon(10, 1)]), 0);
    expect(derive(armed.cultivator).damage).toBeGreaterThan(derive(bare).damage);
    // Same seed, same fights: the armed run kills faster and climbs at least as high.
    const a = tick(armed, 600);
    const b = tick(start, 600);
    expect(a.kills).toBeGreaterThan(b.kills);
    expect(a.highestFloor).toBeGreaterThanOrEqual(b.highestFloor);
  });
});

describe('unequip', () => {
  it('moves the worn item to the end of the bag and frees its position', () => {
    const s = unequip(
      equip(withBag(newGame(1, 'sword'), [weapon(5, 0), weapon(9, 1)]), 0),
      'weapon',
    );
    expect(s.cultivator.equipment.weapon).toBeUndefined();
    expect(Object.hasOwn(s.cultivator.equipment, 'weapon')).toBe(false);
    expect(s.inventory).toEqual([weapon(9, 1), weapon(5, 0)]);
  });

  it('leaves the input state untouched and shares no objects with it', () => {
    const start = equip(withBag(newGame(1, 'sword'), [weapon(5, 0)]), 0);
    const copy = structuredClone(start);
    const s = unequip(start, 'weapon');
    expect(start).toEqual(copy);
    expect(s.inventory[0]).not.toBe(start.cultivator.equipment.weapon);
  });

  it('takes off only the chosen one of two positions', () => {
    const ring = (level: number): Item => ({ ...weapon(level, 0), slot: 'accessory' });
    const worn = equip(equip(withBag(newGame(1, 'sword'), [ring(1), ring(2)]), 0), 0);
    const s = unequip(worn, 'accessory2');
    expect(s.cultivator.equipment).toEqual({ accessory1: ring(1) });
    expect(s.inventory).toEqual([ring(2)]);
  });

  it('rejects an empty position, an unknown one and a full bag', () => {
    const worn = equip(withBag(newGame(1, 'sword'), [weapon(5, 0)]), 0);
    expect(() => unequip(worn, 'charm1')).toThrow(RangeError);
    expect(() => unequip(worn, '__proto__' as 'weapon')).toThrow(RangeError);
    const full = { ...worn, inventory: Array.from({ length: worn.bagSize }, () => weapon(1, 0)) };
    expect(() => unequip(full, 'weapon')).toThrow(RangeError);
    // One free cell is enough.
    const roomy = { ...full, inventory: full.inventory.slice(1) };
    expect(unequip(roomy, 'weapon').inventory).toHaveLength(worn.bagSize);
  });

  it("empties a Soul Banner's souls as it comes off", () => {
    const banner: Item = { ...weapon(5, 0), slot: 'sideArm', name: 'Jade Hundred Ghosts Banner' };
    const worn = { ...equip(withBag(newGame(1, 'talisman'), [banner]), 0), souls: 7 };
    expect(unequip(worn, 'sideArm').souls).toBe(0);
  });

  it('never leaves HP above a lower max HP', () => {
    const pendant: Item = {
      slot: 'accessory',
      name: 'Bone Bead Pendant',
      level: 50,
      grade: 'mortal',
      baseRoll: 1,
      affixes: [],
    };
    const s = equip(withBag(newGame(1, 'body'), [pendant]), 0);
    s.cultivator.hp = derive(s.cultivator).maxHp;
    const off = unequip(s, 'accessory1');
    expect(off.cultivator.hp).toBe(derive(off.cultivator).maxHp);
    expect(off.cultivator.hp).toBeLessThan(s.cultivator.hp);
  });
});

describe('treasure tier realm gate', () => {
  /** A fresh run at `level`, with a `grade` weapon in the bag. */
  function at(level: number, grade: GradeId): GameState {
    const s = withBag(newGame(1, 'sword'), [{ ...weapon(5, 0), grade }]);
    s.cultivator.level = level;
    return s;
  }

  // Each tier at its boundary: the last level of the realm below, then the first allowed.
  it.each([
    ['mortal', 1, null],
    ['spirit', 1, null],
    ['earth', 10, 11],
    ['heaven', 10, 11],
    ['immortal', 20, 21],
  ] as const)('gates a %s weapon: blocked at %s, allowed from %s', (grade, below, from) => {
    if (from === null) {
      expect(equip(at(below, grade), 0).cultivator.equipment.weapon?.grade).toBe(grade);
      return;
    }
    const low = at(below, grade);
    expect(canEquip(low.cultivator, low.inventory[0] as Item)).toBe(false);
    expect(() => equip(low, 0)).toThrow(RangeError);
    expect(equip(at(from, grade), 0).cultivator.equipment.weapon?.grade).toBe(grade);
  });

  it('names the realm each tier needs', () => {
    const w = weapon(5, 0);
    expect(
      ['mortal', 'spirit', 'earth', 'heaven', 'immortal'].map((grade) =>
        requiredRealm({ ...w, grade: grade as GradeId }),
      ),
    ).toEqual([0, 0, 1, 1, 2]);
  });

  it('gates a Vajra Pestle by its tier like any weapon', () => {
    const names = ['Iron', 'Azure Thunder', 'Jade Demon-Subduing', 'Golden', 'Phoenix Flame'];
    expect(
      (['mortal', 'spirit', 'earth', 'heaven', 'immortal'] as const).map((grade, i) =>
        requiredRealm({ ...weapon(5, 0), name: `${names[i]} Vajra Pestle`, grade }),
      ),
    ).toEqual([0, 0, 1, 1, 2]);
  });

  it('gates weapons only', () => {
    for (const slot of [
      'head',
      'chest',
      'boots',
      'attachment',
      'sideArm',
      'accessory',
      'charm',
    ] as const) {
      expect(requiredRealm({ ...weapon(5, 0), slot, grade: 'immortal' })).toBe(0);
    }
  });

  it('gives no gate for a grade it does not know', () => {
    for (const grade of ['__proto__', 'toString', 'constructor'])
      expect(requiredRealm({ ...weapon(5, 0), grade: grade as GradeId })).toBe(0);
  });

  it('leaves the state untouched when blocked', () => {
    const low = at(1, 'immortal');
    const copy = structuredClone(low);
    expect(() => equip(low, 0)).toThrow(RangeError);
    expect(low).toEqual(copy);
  });

  it('keeps an already equipped weapon and swaps it out for an allowed one', () => {
    const s = at(1, 'mortal');
    s.cultivator.equipment.weapon = { ...weapon(9, 1), grade: 'immortal' };
    const after = equip(s, 0);
    expect(after.cultivator.equipment.weapon?.grade).toBe('mortal');
    expect(after.inventory[0]?.grade).toBe('immortal');
    // A gated weapon left on keeps fighting.
    expect(tick(s, 60).cultivator.equipment.weapon?.grade).toBe('immortal');
  });
});

/** Plays one-second steps until `done`, failing rather than looping forever. */
function until(state: GameState, done: (s: GameState) => boolean, limit = 3600): GameState {
  for (let t = 0; t < limit && !done(state); t++) state = tick(state, 1);
  expect(done(state)).toBe(true);
  return state;
}

const hasTribulation = (s: GameState) => s.enemies.some((e) => e.kind === 'tribulation');

describe('Tribulation', () => {
  it.each(PATH_IDS)('holds %s at level 10 until the Tribulation is beaten', (path) => {
    let s = newGame(7, path);
    s = until(s, hasTribulation);
    expect(s.cultivator.level).toBe(10);
    expect(readyForTribulation(s.cultivator)).toBe(true);
    // It closes the floor, after the boss, and it is the first realm's.
    expect(s.enemies[s.enemies.length - 1]).toMatchObject({
      kind: 'tribulation',
      name: TRIBULATIONS[0],
    });
    // Gear is what beats a Tribulation; this bare run gets a harmless one instead.
    let broke = false;
    for (let t = 0; t < 3600 && !broke; t++) {
      for (const e of s.enemies) if (e.kind === 'tribulation') e.damage = 0;
      const before = s;
      s = tick(s, 1);
      if (s.cultivator.level > 10) {
        broke = true;
        // Only a Tribulation kill breaks through.
        expect(before.enemies[0]?.kind).toBe('tribulation');
        expect(s.kills).toBeGreaterThan(before.kills);
      } else {
        expect(s.cultivator.level).toBe(10);
      }
    }
    expect(broke).toBe(true);
  });

  it('is never queued before the cap is reached', () => {
    let s = newGame(3, 'sword');
    while (s.cultivator.level < 10 || !readyForTribulation(s.cultivator)) {
      expect(hasTribulation(s)).toBe(false);
      s = tick(s, 1);
    }
  });

  it('is queued once, never twice, while the cultivator is held', () => {
    let s = until(newGame(7, 'talisman'), hasTribulation);
    for (let t = 0; t < 900; t++) {
      const queued = s.enemies.filter((e) => e.kind === 'tribulation');
      // Once set aside it leaves the floor (see 'Tribulation retry limit').
      if (trialSetAside(s)) expect(queued.length).toBeLessThanOrEqual(1);
      else expect(queued).toHaveLength(1);
      for (const e of s.enemies) if (e.kind === 'tribulation') e.damage = 1e9;
      s = tick(s, 1);
    }
    // It never wins here: held the whole time, losing and replaying the floor.
    expect(s.cultivator.level).toBe(10);
    expect(s.deaths).toBeGreaterThan(0);
  });

  it('replays the same floor, still capped, when the Tribulation wins', () => {
    let s = until(newGame(7, 'sword'), (x) => x.enemies[0]?.kind === 'tribulation');
    s.enemies[0]!.damage = 1e9;
    const { floor, deaths } = s;
    s = until(s, (x) => x.deaths > deaths);
    expect(s.cultivator.level).toBe(10);
    // No drop-back: the same floor from its first wave, the Tribulation at its end.
    expect(s.floor).toBe(floor);
    expect(s.cultivator.hp).toBe(derive(s.cultivator).maxHp);
    expect(readyForTribulation(s.cultivator)).toBe(true);
    expect(s.enemies).toHaveLength(12);
    expect(s.enemies[s.enemies.length - 1]?.kind).toBe('tribulation');
  });

  it('never lets the floor be passed while the Tribulation stands', () => {
    let s = until(newGame(7, 'sword'), hasTribulation);
    const { floor, highestFloor } = s;
    for (let i = 0; i < 600; i++) {
      for (const e of s.enemies) if (e.kind === 'tribulation') e.damage = 1e9;
      s = tick(s, 1);
      expect(s.floor).toBeLessThanOrEqual(floor);
      expect(s.highestFloor).toBe(highestFloor);
      expect(s.cultivator.level).toBe(10);
    }
    expect(s.deaths).toBeGreaterThan(0);
  });

  it('plays the same through a breakthrough in one big step as in small ones', () => {
    const start = newGame(7, 'body');
    const big = tick(start, 900);
    expect(big.cultivator.level).toBeGreaterThan(10);
    expect(big).toEqual(run(start, 900, 1));
  });

  it('pays out a drop and Spirit Stones for the Tribulation', () => {
    let s = until(newGame(7, 'body'), (x) => x.enemies[0]?.kind === 'tribulation');
    s.enemies[0]!.hp = 1;
    const before = s;
    s = until(s, (x) => x.kills > before.kills);
    expect(s.cultivator.level).toBeGreaterThan(10);
    expect(s.stones).toBeGreaterThan(before.stones);
    expect(s.inventory.length + s.dropsSold + s.dropsSalvaged).toBe(
      before.inventory.length + before.dropsSold + before.dropsSalvaged + 1,
    );
    // The held XP went into levels past the cap.
    expect(s.cultivator.xp).toBeLessThan(xpToNext(s.cultivator.level));
  });
});

describe('faceTribulation', () => {
  it('can only be called while a Tribulation is due and not yet fought', () => {
    const fresh = newGame(7, 'sword');
    expect(canFaceTribulation(fresh)).toBe(false);
    expect(() => faceTribulation(fresh)).toThrow(RangeError);
    const due = until(fresh, (x) => hasTribulation(x) && x.enemies[0]?.kind !== 'tribulation');
    expect(canFaceTribulation(due)).toBe(true);
    const fighting = until(due, (x) => x.enemies[0]?.kind === 'tribulation');
    expect(canFaceTribulation(fighting)).toBe(false);
    expect(() => faceTribulation(fighting)).toThrow(RangeError);
  });

  /** The first Tribulation (level 10) queued, the enemy it will interrupt still in front. */
  const firstDue = (x: GameState) =>
    hasTribulation(x) && x.cultivator.level === 10 && x.enemies[0]?.kind !== 'tribulation';

  it('brings the Tribulation to the front at full HP, the interrupted enemy behind it', () => {
    const s = until(newGame(7, 'sword'), firstDue);
    s.cultivator.hp = 1;
    const interrupted = s.enemies[0]!;
    const next = faceTribulation(s);
    expect(next.enemies[0]).toMatchObject({ kind: 'tribulation', name: TRIBULATIONS[0] });
    expect(next.enemies[1]).toEqual(interrupted);
    expect(next.enemies).toHaveLength(s.enemies.length);
    expect(next.enemies.filter((e) => e.kind === 'tribulation')).toHaveLength(1);
    expect(next.cultivator.hp).toBe(derive(next.cultivator).maxHp);
    // Both sides wait out the arrival pause, as after any kill.
    expect(next.cultivator.nextAttackAt).toBeGreaterThan(s.time + ENEMY_ARRIVAL);
    expect(next.enemyNextAttackAt).toBeGreaterThan(s.time + ENEMY_ARRIVAL);
    // The old state is untouched.
    expect(s.enemies[0]).toBe(interrupted);
    expect(s.cultivator.hp).toBe(1);
  });

  it('draws no randomness, and plays the same after it in one big step as in small ones', () => {
    const s = until(newGame(7, 'body'), (x) => hasTribulation(x) && x.enemies.length > 2);
    const faced = faceTribulation(s);
    expect(faced.rng).toEqual(s.rng);
    expect(tick(faced, 300)).toEqual(run(faced, 300, 0.5));
  });

  it('works in the arrival pause, before either side has attacked', () => {
    const s = until(newGame(7, 'sword'), (x) => hasTribulation(x) && x.enemies.length > 2);
    // Just after a kill: the next enemy has not arrived yet.
    const kills = s.kills;
    let paused = s;
    while (paused.kills === kills) paused = tick(paused, 0.05);
    expect(paused.cultivator.nextAttackAt).toBeGreaterThan(paused.time + ENEMY_ARRIVAL / 2);
    const next = faceTribulation(paused);
    expect(next.enemies[0]?.kind).toBe('tribulation');
    expect(next.cultivator.nextAttackAt).toBeGreaterThan(paused.time + ENEMY_ARRIVAL);
    expect(next.enemyNextAttackAt).toBeGreaterThan(paused.time + ENEMY_ARRIVAL);
  });

  it('faces the last realm cap, level 210, with its own Tribulation', () => {
    const s = newGame(7, 'sword');
    s.cultivator.level = 210;
    s.cultivator.xp = xpToNext(210);
    expect(canFaceTribulation(s)).toBe(true);
    const next = faceTribulation(s);
    expect(next.enemies[0]).toMatchObject({ kind: 'tribulation', name: TRIBULATIONS[8] });
    expect(next.enemies).toHaveLength(s.enemies.length + 1);
  });

  it('makes the Tribulation when a due state has none queued', () => {
    const s = until(newGame(7, 'sword'), hasTribulation);
    s.enemies = s.enemies.filter((e) => e.kind !== 'tribulation');
    const next = faceTribulation(s);
    expect(next.enemies[0]).toMatchObject({ kind: 'tribulation', name: TRIBULATIONS[0] });
    expect(next.enemies).toHaveLength(s.enemies.length + 1);
  });

  it('breaks through on a win, then fights the interrupted enemy on the same floor', () => {
    let s = until(newGame(7, 'body'), (x) => hasTribulation(x) && x.enemies.length > 2);
    const { floor } = s;
    const left = s.enemies.length - 1;
    s = faceTribulation(s);
    s.enemies[0]!.hp = 1;
    const kills = s.kills;
    s = until(s, (x) => x.kills > kills);
    expect(s.cultivator.level).toBeGreaterThan(10);
    expect(s.floor).toBe(floor);
    expect(s.enemies).toHaveLength(left);
    expect(hasTribulation(s)).toBe(false);
  });

  it('replays the floor on a loss, with the Tribulation due again', () => {
    let s = until(newGame(7, 'sword'), firstDue);
    const { floor, deaths } = s;
    s = faceTribulation(s);
    s.enemies[0]!.damage = 1e9;
    s = until(s, (x) => x.deaths > deaths);
    expect(s.floor).toBe(floor);
    expect(s.cultivator.level).toBe(10);
    expect(canFaceTribulation(s)).toBe(true);
  });
});

describe('characterStatus', () => {
  /** A floor-12 run facing a `front` enemy, a Tribulation due or not. */
  function facing(front: EnemyKind, due: boolean): GameState {
    const s = newGame(7, 'sword');
    s.floor = 12;
    s.cultivator.level = 10;
    s.cultivator.xp = due ? xpToNext(10) : 0;
    const enemy = front === 'tribulation' ? makeTribulation(12, 0) : makeEnemy(12, front, 'Foe');
    s.enemies = [enemy, makeEnemy(12, 'demon', 'Next')];
    return s;
  }

  it.each([
    ['demon', 'cultivating'],
    ['elite', 'elite'],
    ['boss', 'boss'],
    ['tribulation', 'tribulation'],
  ] as const)('names a %s at the front as %s', (front, kind) => {
    expect(characterStatus(facing(front, false))).toEqual({ kind, floor: 12 });
  });

  it('is cultivating with no enemy at all', () => {
    const s = facing('demon', false);
    s.enemies = [];
    expect(characterStatus(s)).toEqual({ kind: 'cultivating', floor: 12 });
  });

  it('puts a due Tribulation ahead of a boss, an elite or a demon', () => {
    for (const front of ['demon', 'elite', 'boss'] as const) {
      expect(characterStatus(facing(front, true)).kind).toBe('tribulationDue');
    }
  });

  it('puts the Tribulation being fought ahead of it being due', () => {
    const s = facing('tribulation', true);
    expect(readyForTribulation(s.cultivator)).toBe(true);
    expect(characterStatus(s).kind).toBe('tribulation');
  });

  it('follows a real run, and leaves the state untouched', () => {
    const due = until(newGame(7, 'sword'), (x) => canFaceTribulation(x));
    const before = structuredClone(due);
    expect(characterStatus(due)).toEqual({ kind: 'tribulationDue', floor: due.floor });
    expect(due).toEqual(before);
    expect(characterStatus(faceTribulation(due)).kind).toBe('tribulation');
  });
});

describe('Formation Disc arrays', () => {
  function disc(array: ArrayId, grade: GradeId = 'immortal', baseRoll = 1): Item {
    const name = namesFor('attachment', grade)[1] as string;
    return { slot: 'attachment', name, level: 1, grade, baseRoll, affixes: [], array };
  }

  /** A new run with `item` worn; it takes effect from the next fight. */
  function wearing(item: Item | null, seed = 3): GameState {
    const s = newGame(seed, 'sword');
    if (item) s.cultivator.equipment.attachment = item;
    return s;
  }

  /** Plays to the first kill and stops on it, so the next fight has just been set up. */
  function atFirstKill(s: GameState): GameState {
    const x = structuredClone(s);
    (x.enemies[0] as { hp: number }).hp = 1;
    return tick(x, x.cultivator.nextAttackAt - x.time);
  }

  /** An endless fight: neither side can fall, and the cultivator never attacks. */
  function standoff(s: GameState, cultivatorAttacks = false): GameState {
    const x = structuredClone(s);
    (x.enemies[0] as { hp: number }).hp = 1e12;
    x.cultivator.hp = 1e12;
    if (!cultivatorAttacks) x.cultivator.nextAttackAt = 1e15;
    return x;
  }

  describe('Binding Array', () => {
    it("holds back the enemy's first attack of every fight by its strength", () => {
      const item = disc('binding', 'earth', 0.4);
      const plain = atFirstKill(wearing(null));
      const bound = atFirstKill(wearing(item));
      expect(bound.kills).toBe(1);
      expect(bound.enemyNextAttackAt - plain.enemyNextAttackAt).toBeCloseTo(arrayValue(item), 9);
      expect(bound.enemyNextAttackAt).toBeCloseTo(
        bound.time + ENEMY_ARRIVAL + (bound.enemies[0]?.attackInterval ?? 0) + 1.7,
        9,
      );
      // The cultivator's own timing is unchanged.
      expect(bound.cultivator.nextAttackAt).toBe(plain.cultivator.nextAttackAt);
    });

    it('delays only the first attack: the next comes one interval later', () => {
      const s = atFirstKill(wearing(disc('binding')));
      const first = s.enemyNextAttackAt;
      // Just past it: the clock sum can land a hair short of the attack.
      const after = tick(standoff(s), first - s.time + 0.01);
      expect(after.enemyNextAttackAt).toBeCloseTo(first + (s.enemies[0]?.attackInterval ?? 0), 9);
    });

    it('sets up for a Tribulation faced early too', () => {
      let s = wearing(disc('binding'));
      s = until(s, canFaceTribulation, 7200);
      const faced = faceTribulation(s);
      const interval = faced.enemies[0]?.attackInterval ?? 0;
      expect(faced.enemyNextAttackAt).toBeCloseTo(faced.time + ENEMY_ARRIVAL + interval + 3, 9);
    });
  });

  describe('Illusion Array', () => {
    /** Share of enemy attacks that did no damage over `seconds` of a standoff. */
    function missShare(item: Item | null, seconds: number): number {
      const s = standoff(atFirstKill(wearing(item)));
      const enemy = s.enemies[0] as { damage: number; attackInterval: number };
      const hit = mitigate(enemy.damage, derive(s.cultivator).defence);
      const attacks =
        Math.floor((s.time + seconds - s.enemyNextAttackAt) / enemy.attackInterval) + 1;
      const end = tick(s, seconds);
      const hits = (s.cultivator.hp - end.cultivator.hp) / hit;
      return 1 - hits / attacks;
    }

    it('makes enemy attacks miss at about its strength', () => {
      expect(missShare(null, 20_000)).toBe(0);
      const share = missShare(disc('illusion'), 20_000);
      expect(share).toBeGreaterThan(0.16);
      expect(share).toBeLessThan(0.2);
    });

    it('rolls its misses from the seed', () => {
      const s = standoff(atFirstKill(wearing(disc('illusion'))));
      expect(tick(s, 600)).toEqual(tick(s, 600));
      expect(tick(s, 600)).toEqual(run(s, 600, 1));
    });
  });

  describe('Killing Array', () => {
    it('hits once a second from the start of the fight for its share of damage', () => {
      const item = disc('killing', 'earth', 0.5);
      const s = standoff(atFirstKill(wearing(item)));
      const enemy = s.enemies[0] as { hp: number; defence: number };
      const d = derive(s.cultivator);
      const per = mitigate((d.damage / d.attackInterval) * 0.175, enemy.defence);
      // The fight starts after the pause; the first hit comes a second later.
      const start = s.time + ENEMY_ARRIVAL;
      const end = tick(s, ENEMY_ARRIVAL + 10.5);
      expect(start + ARRAY_TICK).toBe(s.arrayNextAt);
      expect(enemy.hp - (end.enemies[0] as { hp: number }).hp).toBe(10 * per);
      expect(end.cultivator.hp).toBeLessThan(s.cultivator.hp);
    });

    it('does nothing without a Killing Array', () => {
      const s = standoff(atFirstKill(wearing(disc('binding'))));
      const end = tick(s, 100);
      expect((end.enemies[0] as { hp: number }).hp).toBe(1e12);
    });

    it('counts a kill by the array as any other kill', () => {
      const s = standoff(atFirstKill(wearing(disc('killing'))));
      (s.enemies[0] as { hp: number }).hp = 1;
      const end = tick(s, ENEMY_ARRIVAL + ARRAY_TICK);
      expect(end.kills).toBe(s.kills + 1);
      expect(end.enemies.length).toBe(s.enemies.length - 1);
      expect(end.cultivator.xp + end.cultivator.level).toBeGreaterThan(
        s.cultivator.xp + s.cultivator.level,
      );
    });

    it('hits at once when equipped mid-fight, never in the past', () => {
      let s = standoff(atFirstKill(wearing(null)));
      s = tick(s, 30);
      s.cultivator.equipment.attachment = disc('killing');
      expect(s.arrayNextAt).toBeLessThan(s.time);
      const end = tick(s, 0.5);
      expect((end.enemies[0] as { hp: number }).hp).toBeLessThan(1e12);
      expect(end.arrayNextAt).toBeCloseTo(s.time + ARRAY_TICK, 9);
    });
  });

  it('gives the same result for one big step as many small ones after a mid-fight equip', () => {
    // Partway into a fight, with no disc: the array timer has gone stale.
    let s = tick(wearing(null, 9), 95.3);
    while (s.arrayNextAt >= s.time) s = tick(s, 0.3);
    s = { ...s, cultivator: { ...s.cultivator, equipment: { attachment: disc('killing') } } };
    expect(s.arrayNextAt).toBeLessThan(s.time);
    expect(run(s, 600, 0.5)).toEqual(tick(s, 600));
    // And after a save: the stale timer survives JSON as it is.
    expect(tick(JSON.parse(JSON.stringify(s)) as GameState, 600)).toEqual(tick(s, 600));
  });

  it.each<ArrayId>(['binding', 'illusion', 'killing'])(
    'gives the same result for one big step as many small ones with a %s array',
    (array) => {
      const start = wearing(disc(array, 'heaven', 0.6), 9);
      expect(run(start, 1800, 0.5)).toEqual(tick(start, 1800));
    },
  );

  it.each<ArrayId>(['binding', 'illusion', 'killing'])(
    'gives the same result for one big offline step as many small ones with a %s array',
    (array) => {
      const start = wearing(disc(array, 'heaven', 0.6), 9);
      const offline = { offline: true };
      const big = tick(start, 1800, offline);
      expect(big.kills).toBeGreaterThan(0);
      expect(run(start, 1800, 0.5, offline)).toEqual(big);
    },
  );
});

describe('Soul Banners', () => {
  /** A Hidden Weapon of `family` (0 Darts, 1 Binding Rope, 2 Soul Banner). */
  function hidden(family: number, grade: GradeId = 'mortal'): Item {
    const name = namesFor('sideArm', grade)[family] as string;
    return { slot: 'sideArm', name, level: 1, grade, baseRoll: 0.5, affixes: [] };
  }

  /** A new Talisman run with `item` worn as its Hidden Weapon. */
  function wearing(item: Item | null, seed = 5): GameState {
    const s = newGame(seed, 'talisman');
    if (item) s.cultivator.equipment.sideArm = item;
    return s;
  }

  it('starts every run with no souls', () => {
    expect(newGame(1, 'talisman').souls).toBe(0);
  });

  it('gains one soul per kill while a banner is worn, up to its cap', () => {
    let s = wearing(hidden(2, 'mortal'));
    for (let n = 0; n < 200 && s.kills < SOUL_CAPS.mortal + 5; n++) {
      const before = s;
      s = tick(s, 1);
      expect(s.souls, `after ${s.kills} kills`).toBe(Math.min(SOUL_CAPS.mortal, s.kills));
      expect(s.souls).toBeGreaterThanOrEqual(before.souls);
    }
    expect(s.kills).toBeGreaterThan(SOUL_CAPS.mortal);
    expect(s.souls).toBe(SOUL_CAPS.mortal);
  });

  it('holds more souls on a higher grade', () => {
    const s = tick(wearing(hidden(2, 'immortal')), 1800);
    expect(s.kills).toBeGreaterThan(SOUL_CAPS.immortal);
    expect(s.souls).toBe(SOUL_CAPS.immortal);
  });

  it.each([
    ['no Hidden Weapon', null],
    ['Darts', 0],
    ['a Binding Rope', 1],
  ] as const)('gathers no souls with %s', (_, family) => {
    const s = tick(wearing(family === null ? null : hidden(family)), 600);
    expect(s.kills).toBeGreaterThan(0);
    expect(s.souls).toBe(0);
  });

  it('adds 1% of Spirit per soul to every attack, after crit and burst', () => {
    // An enemy with no defence that can't fall: the hit lands as dealt.
    const base = wearing(hidden(2, 'heaven'));
    base.cultivator.stats.spirit = 200;
    const enemy = base.enemies[0] as { hp: number; defence: number };
    enemy.hp = 1e12;
    enemy.defence = 0;
    const hit = (souls: number) => {
      const s = structuredClone(base);
      s.souls = souls;
      const after = tick(s, s.cultivator.nextAttackAt - s.time);
      return 1e12 - (after.enemies[0] as { hp: number }).hp;
    };
    // The same seed rolls the same crit, so only the souls differ.
    // Each hit is rounded to a whole number, so the difference may be off by 1.
    const extra = hit(25) - hit(0);
    expect(soulDamage(25, 200)).toBe(50);
    expect(Math.abs(extra - 50)).toBeLessThanOrEqual(1);
    expect(hit(0)).toBeGreaterThan(0);
  });

  it('keeps its souls through a lost fight', () => {
    let s = tick(wearing(hidden(2, 'earth')), 120);
    expect(s.souls).toBeGreaterThan(0);
    const souls = s.souls;
    const deaths = s.deaths;
    s = structuredClone(s);
    s.cultivator.hp = 1;
    s.cultivator.nextAttackAt = 1e15;
    s = tick(s, s.enemyNextAttackAt - s.time);
    expect(s.deaths).toBe(deaths + 1);
    expect(s.souls).toBe(souls);
  });

  it('clears the souls when the banner is replaced by any Hidden Weapon', () => {
    for (const family of [0, 1, 2]) {
      const s = tick(wearing(hidden(2, 'earth')), 120);
      expect(s.souls).toBeGreaterThan(0);
      s.inventory = [hidden(family, 'spirit')];
      expect(equip(s, 0).souls, `family ${family}`).toBe(0);
      expect(equip(s, 0).inventory).toEqual([s.cultivator.equipment.sideArm]);
    }
  });

  it('keeps the souls when another item type is equipped', () => {
    const s = tick(wearing(hidden(2, 'earth')), 120);
    expect(s.souls).toBeGreaterThan(0);
    s.inventory = [{ ...hidden(0), slot: 'head', name: namesFor('head', 'mortal')[0] as string }];
    expect(equip(s, 0).souls).toBe(s.souls);
  });

  it('clears the souls on Early Retirement', () => {
    const s = tick(wearing(hidden(2, 'earth')), 120);
    expect(s.souls).toBeGreaterThan(0);
    s.highestFloor = 20;
    expect(retire(s).souls).toBe(0);
  });

  it('gives the same result for one big step as many small ones with a banner', () => {
    const start = wearing(hidden(2, 'heaven'), 9);
    expect(run(start, 1800, 0.5)).toEqual(tick(start, 1800));
  });
});

describe('qi', () => {
  /** A copy where only the events turned on happen: no attacks, no regen step. */
  function quiet(state: GameState, on: { you?: boolean; foe?: boolean; regen?: boolean } = {}) {
    const x = structuredClone(state);
    x.cultivator.hp = 1e12;
    (x.enemies[0] as { hp: number }).hp = 1e12;
    if (!on.you) x.cultivator.nextAttackAt = 1e15;
    if (!on.foe) x.enemyNextAttackAt = 1e15;
    if (!on.regen) x.qiNextAt = 1e15;
    return x;
  }
  /** A run whose enemy in front is the floor's elite (or another kind). */
  function facing(kind: EnemyKind, seed = 3): GameState {
    const s = newGame(seed, 'sword');
    s.enemies = s.enemies.filter((e) => e.kind === kind);
    if (s.enemies.length === 0) s.enemies = [makeEnemy(1, kind, 'Test Demon')];
    return s;
  }
  const charm = (roll: number): Item => ({
    slot: 'charm',
    name: namesFor('charm', 'spirit')[0] as string,
    level: 1,
    grade: 'spirit',
    baseRoll: 0,
    affixes: [{ id: 'qiRegen', roll }],
  });

  it('starts a run at 0, the first regen step a second in', () => {
    const s = newGame(7, 'sword');
    expect(s.cultivator.qi).toBe(0);
    expect(s.qiNextAt).toBe(QI_TICK);
    expect(s.enemies.every((e) => e.qi === 0)).toBe(true);
  });

  it.each([
    ['talisman', 1],
    ['sword', 0.5],
    ['body', 0.5],
  ] as const)('gives %s Spirit qi at a share of %d: max qi and regen alike', (path, share) => {
    const c = newGame(7, path).cultivator;
    for (const spirit of [5, 55, 305]) {
      c.stats.spirit = spirit;
      const d = derive(c);
      expect(d.maxQi).toBe(Math.round(BASE_MAX_QI + MAX_QI_PER_SPIRIT * share * spirit));
      expect(d.qiRegen).toBeCloseTo(QI_BASE_REGEN + QI_PER_SPIRIT * share * spirit, 9);
    }
  });

  it('reads the Qi regen stat as a share of max qi each second', () => {
    const c = newGame(7, 'sword').cultivator;
    c.stats.spirit = BASE_MAX_QI / MAX_QI_PER_SPIRIT;
    const bare = derive(c).qiRegen;
    const worn = charm(1);
    c.equipment.charm1 = worn;
    const roll = itemAffixValue(worn, worn.affixes[0] as Item['affixes'][number]);
    // A 4% roll is 4 qi a second at 100 max qi, and more with a bigger pool.
    expect(derive(c).maxQi).toBe(150);
    expect(derive(c).qiRegen - bare).toBeCloseTo(roll * 150, 9);
  });

  it('counts Spirit as it fights, realm bonus included', () => {
    const c = newGame(7, 'talisman').cultivator;
    c.level = 11;
    const spirit = effectiveStats(c).spirit;
    expect(spirit).toBeGreaterThan(c.stats.spirit);
    expect(derive(c).qiRegen).toBeCloseTo(QI_BASE_REGEN + QI_PER_SPIRIT * spirit, 9);
    expect(derive(c).maxQi).toBe(Math.round(BASE_MAX_QI + MAX_QI_PER_SPIRIT * spirit));
  });

  it('adds a second of regen at each step, between fights too', () => {
    const s = quiet(newGame(7, 'sword'), { regen: true });
    s.cultivator.equipment.charm1 = charm(0.5);
    const rate = derive(s.cultivator).qiRegen;
    const next = tick(s, 3.5);
    expect(next.cultivator.qi).toBeCloseTo(3 * rate, 9);
    expect(next.qiNextAt).toBe(4);
  });

  it('gains qi per attack and per hit taken', () => {
    const attack = quiet(newGame(7, 'sword'), { you: true });
    const swung = tick(attack, attack.cultivator.nextAttackAt - attack.time);
    expect(swung.cultivator.qi).toBe(QI_PER_ATTACK);
    const hit = quiet(newGame(7, 'sword'), { foe: true });
    const struck = tick(hit, hit.enemyNextAttackAt - hit.time);
    expect(struck.cultivator.qi).toBe(QI_PER_HIT_TAKEN);
  });

  it('gains nothing for a hit an Illusion Array turns aside', () => {
    const s = quiet(newGame(7, 'sword'), { foe: true });
    const name = namesFor('attachment', 'immortal')[1] as string;
    s.cultivator.equipment.attachment = {
      slot: 'attachment',
      name,
      level: 1,
      grade: 'immortal',
      baseRoll: 1,
      affixes: [],
      array: 'illusion',
    };
    let x = s;
    let dodged = 0;
    let hits = 0;
    for (let i = 0; i < 200; i++) {
      const before = x.cultivator.hp;
      x = tick(x, x.enemyNextAttackAt - x.time);
      const hit = x.cultivator.hp < before;
      if (hit) hits++;
      else dodged++;
      expect(x.cultivator.qi).toBe(hit ? QI_PER_HIT_TAKEN : 0);
      x.cultivator.qi = 0;
    }
    expect(dodged).toBeGreaterThan(0);
    expect(hits).toBeGreaterThan(0);
  });

  it.each(PATH_IDS)('never takes %s past max qi', (path) => {
    const s = quiet(newGame(7, path), { you: true, foe: true, regen: true });
    const max = derive(s.cultivator).maxQi;
    s.cultivator.qi = max - 1;
    const next = tick(s, 60);
    expect(next.cultivator.qi).toBe(max);
  });

  it('carries over between fights on a floor', () => {
    const s = newGame(7, 'sword');
    s.cultivator.qi = 50;
    s.qiNextAt = 1e15;
    s.enemyNextAttackAt = 1e15;
    (s.enemies[0] as { hp: number }).hp = 1;
    const next = tick(s, s.cultivator.nextAttackAt - s.time);
    expect(next.kills).toBe(1);
    expect(next.floor).toBe(1);
    expect(next.cultivator.qi).toBe(50 + QI_PER_ATTACK);
  });

  it('starts each new floor, and each floor played again, at 0', () => {
    const s = newGame(7, 'sword');
    s.cultivator.qi = 50;
    s.qiNextAt = 1e15;
    s.enemyNextAttackAt = 1e15;
    s.enemies = [s.enemies.at(-1) as (typeof s.enemies)[number]];
    (s.enemies[0] as { hp: number }).hp = 1;
    const cleared = tick(s, s.cultivator.nextAttackAt - s.time);
    expect(cleared.floor).toBe(2);
    expect(cleared.cultivator.qi).toBe(0);
    const again = restartFloor({ ...cleared, cultivator: { ...cleared.cultivator, qi: 70 } });
    expect(again.cultivator.qi).toBe(0);
    // And after a loss.
    const losing = quiet(newGame(7, 'sword'), { foe: true });
    losing.cultivator.hp = 1;
    losing.cultivator.qi = 70;
    const lost = tick(losing, losing.enemyNextAttackAt - losing.time);
    expect(lost.deaths).toBe(1);
    expect(lost.cultivator.qi).toBe(0);
  });

  it('is full when a Tribulation starts, faced early or at the end of the floor', () => {
    const due = until(
      newGame(7, 'sword'),
      (x) => hasTribulation(x) && x.enemies[0]?.kind !== 'tribulation',
    );
    const max = derive(due.cultivator).maxQi;
    expect(
      faceTribulation({ ...due, cultivator: { ...due.cultivator, qi: 3 } }).cultivator.qi,
    ).toBe(max);
    // Reached in turn: the kill before it starts the fight with full qi.
    const last = structuredClone(due);
    last.enemies = last.enemies.slice(-2);
    expect(last.enemies.map((e) => e.kind)).toEqual(['boss', 'tribulation']);
    (last.enemies[0] as { hp: number }).hp = 1;
    last.cultivator.qi = 3;
    last.qiNextAt = 1e15;
    last.enemyNextAttackAt = 1e15;
    const reached = tick(last, last.cultivator.nextAttackAt - last.time);
    expect(reached.enemies[0]?.kind).toBe('tribulation');
    expect(reached.cultivator.qi).toBe(max);
  });

  it.each([
    ['elite', 60],
    ['boss', 100],
    ['tribulation', 150],
  ] as const)('fills a %s up to %i by attacking plus a trickle', (kind, max) => {
    expect(ENEMY_MAX_QI[kind]).toBe(max);
    const s = quiet(facing(kind), { foe: true, regen: true });
    const foe = s.enemies[0] as { attackInterval: number };
    // One attack and its interval's trickle.
    const one = tick(s, foe.attackInterval * 1.5);
    expect(one.enemies[0]?.qi).toBe(
      ENEMY_QI_PER_ATTACK + ENEMY_QI_REGEN * Math.floor(foe.attackInterval * 1.5),
    );
    expect(tick(s, 600).enemies[0]?.qi).toBe(max);
  });

  it('gives regular demons no qi at all', () => {
    const s = quiet(newGame(7, 'sword'), { foe: true, regen: true });
    expect(s.enemies[0]?.kind).toBe('demon');
    expect(ENEMY_MAX_QI.demon).toBe(0);
    expect(tick(s, 120).enemies[0]?.qi).toBe(0);
  });

  it.each(PATH_IDS)('gives %s the same qi for one big step as many small ones', (path) => {
    const start = newGame(5, path);
    start.cultivator.equipment.charm1 = charm(0.7);
    const big = tick(start, 900);
    expect(run(start, 900, 0.5)).toEqual(big);
    expect(big.cultivator.qi).toBeGreaterThan(0);
  });
});

describe('Path balance', () => {
  /**
   * Rough fighting strength, to pick upgrades: damage per second times
   * toughness, with a disc's array counted too: a Killing Array adds its share
   * of damage every second, an Illusion Array cuts the hits taken, and a
   * Binding Array skips about delay / 2 s of a fight's enemy attacks (fights
   * run about ten seconds). A Soul Banner counts as full: it fills within a
   * floor or two.
   */
  function power(state: GameState): number {
    const c = state.cultivator;
    const d = derive(c);
    const array = equippedArray(c.equipment);
    const share = (id: string) => (array?.id === id ? array.value : 0);
    const dps =
      (d.damage / d.attackInterval) * (1 + d.critChance * (d.critMultiplier - 1)) +
      (d.damage / d.attackInterval) * share('killing') +
      soulDamage(soulCap(c.equipment), c.stats.spirit) / d.attackInterval;
    const toughness =
      (d.maxHp * (1 + d.defence / 50) * (1 + share('binding') / 10)) / (1 - share('illusion'));
    return (dps * toughness) / (1 - d.lifesteal);
  }

  /** A player who checks in every minute, equips every upgrade and empties the bag. */
  function play(seed: number, path: PathId, minutes: number): GameState {
    let s = newGame(seed, path);
    for (let m = 0; m < minutes; m++) {
      s = tick(s, 60);
      for (let i = 0; i < s.inventory.length; i++) {
        const item = s.inventory[i] as Item;
        if (!canEquip(s.cultivator, item)) continue;
        for (const to of slotsFor(item.slot)) {
          const next = equip(s, i, to);
          if (power(next) > power(s) * 1.001) {
            s = next;
            i = -1;
            break;
          }
        }
      }
      s = { ...s, inventory: [] };
    }
    return s;
  }

  // Enough seeds that luck doesn't decide it: a seed is a floor or two either
  // way, and at 16 seeds one Path's unlucky run could cross the line alone.
  const SEEDS = 64;

  it(
    'keeps every Path within 15% of the others on the floor reached',
    () => {
      for (const minutes of [10, 60]) {
        const floors = PATH_IDS.map((path) => {
          let sum = 0;
          for (let seed = 1; seed <= SEEDS; seed++) sum += play(seed, path, minutes).highestFloor;
          return sum / SEEDS;
        });
        expect(Math.max(...floors) / Math.min(...floors)).toBeLessThan(1.15);
      }
    },
    LONG_SIM_MS,
  );
});

describe('Tribulation retry limit', () => {
  /** Held at level 10 with the Tribulation queued at the end of the floor. */
  const held = (): GameState => until(newGame(7, 'sword'), hasTribulation);

  /** Faces the Tribulation (unless it is already in front) and loses to it. */
  function loseTrial(state: GameState): GameState {
    const losses = state.trial.losses;
    const s =
      state.enemies[0]?.kind === 'tribulation' ? structuredClone(state) : faceTribulation(state);
    s.enemies[0]!.damage = 1e9;
    return until(s, (x) => x.trial.losses > losses, 60);
  }

  /** Loses `n` times in a row. */
  function loseTimes(state: GameState, n: number): GameState {
    for (let i = 0; i < n; i++) state = loseTrial(state);
    return state;
  }

  it(`sets it aside after exactly ${TRIAL_LOSS_LIMIT} losses in a row, not before`, () => {
    let s = held();
    for (let i = 1; i < TRIAL_LOSS_LIMIT; i++) {
      s = loseTrial(s);
      expect(s.trial.losses).toBe(i);
      expect(trialSetAside(s)).toBe(false);
      // Unchanged before the limit: the floor replays with it at the end.
      expect(s.enemies[s.enemies.length - 1]?.kind).toBe('tribulation');
      expect(characterStatus(s).kind).toBe('tribulationDue');
    }
    s = loseTrial(s);
    expect(s.trial.losses).toBe(TRIAL_LOSS_LIMIT);
    expect(trialSetAside(s)).toBe(true);
    expect(hasTribulation(s)).toBe(false);
    expect(characterStatus(s).kind).toBe('tribulationPaused');
    // Still due, so the alert's Try again can start it.
    expect(readyForTribulation(s.cultivator)).toBe(true);
    expect(canFaceTribulation(s)).toBe(true);
  });

  it('records the time and the strength of the last loss', () => {
    const s = loseTrial(held());
    const d = derive(s.cultivator);
    expect(s.trial.lostDamage).toBe(d.damage);
    expect(s.trial.lostMaxHp).toBe(d.maxHp);
    expect(s.trial.lostAt).toBeLessThanOrEqual(s.time);
    expect(s.trial.lostAt).toBeGreaterThan(s.time - 60);
  });

  it('keeps farming the same floor while set aside, never passing it', () => {
    const s = loseTimes(held(), TRIAL_LOSS_LIMIT);
    const later = tick(s, TRIAL_RETRY_SECONDS - 60);
    expect(later.floor).toBe(s.floor);
    expect(later.highestFloor).toBe(s.highestFloor);
    expect(later.kills).toBeGreaterThan(s.kills + 10);
    expect(later.cultivator.level).toBe(s.cultivator.level);
    expect(hasTribulation(later)).toBe(false);
  });

  it(`retries once ${TRIAL_RETRY_SECONDS / 60} minutes after the last loss, at the end of the floor`, () => {
    const s = loseTimes(held(), TRIAL_LOSS_LIMIT);
    const before = tick(s, TRIAL_RETRY_SECONDS - 60);
    expect(trialRetryDue(before)).toBe(false);
    expect(trialRetryIn(before)).toBeCloseTo(s.trial.lostAt + TRIAL_RETRY_SECONDS - before.time, 9);
    const queued = until(before, hasTribulation, 120);
    expect(queued.time).toBeGreaterThanOrEqual(s.trial.lostAt + TRIAL_RETRY_SECONDS);
    expect(queued.enemies[queued.enemies.length - 1]?.kind).toBe('tribulation');
    expect(trialRetryIn(queued)).toBe(0);
  });

  it('sets it aside again after a lost retry, restarting the timer', () => {
    const s = loseTimes(held(), TRIAL_LOSS_LIMIT);
    const queued = until(tick(s, TRIAL_RETRY_SECONDS), hasTribulation, 120);
    const again = loseTrial(queued);
    expect(again.trial.losses).toBe(TRIAL_LOSS_LIMIT + 1);
    expect(again.trial.lostAt).toBeGreaterThan(s.trial.lostAt + TRIAL_RETRY_SECONDS);
    expect(trialSetAside(again)).toBe(true);
    expect(hasTribulation(again)).toBe(false);
    expect(trialRetryDue(again)).toBe(false);
    // Not before another full wait.
    expect(hasTribulation(tick(again, TRIAL_RETRY_SECONDS - 60))).toBe(false);
  });

  it('gives Try again a single try: a loss sets it aside again', () => {
    const s = loseTimes(held(), TRIAL_LOSS_LIMIT);
    const tried = loseTrial(s);
    expect(tried.trial.losses).toBe(TRIAL_LOSS_LIMIT + 1);
    expect(hasTribulation(tried)).toBe(false);
  });

  it('clears the loss count on a win', () => {
    const s = faceTribulation(loseTimes(held(), TRIAL_LOSS_LIMIT));
    s.enemies[0]!.hp = 1;
    const won = until(s, (x) => x.cultivator.level > 10, 60);
    expect(won.trial).toEqual({ auto: true, losses: 0, lostAt: 0, lostDamage: 0, lostMaxHp: 0 });
    expect(trialSetAside(won)).toBe(false);
  });

  it('clears the loss count on a win before the limit too', () => {
    const s = loseTrial(held());
    const at = s.enemies.findIndex((e) => e.kind === 'tribulation');
    s.enemies[at]!.hp = 1;
    const won = until(s, (x) => x.cultivator.level > 10);
    expect(won.trial.losses).toBe(0);
  });

  describe(`the stronger trigger (${TRIAL_STRONGER * 100}%)`, () => {
    const aside = (): GameState => loseTimes(held(), TRIAL_LOSS_LIMIT);

    it('fires on damage at exactly the threshold and not just under it', () => {
      const s = aside();
      const d = derive(s.cultivator);
      s.trial.lostDamage = d.damage / (1 + TRIAL_STRONGER) + 1e-6;
      expect(trialRetryDue(s)).toBe(false);
      s.trial.lostDamage = d.damage / (1 + TRIAL_STRONGER) - 1e-6;
      expect(trialRetryDue(s)).toBe(true);
    });

    it('fires on max HP at exactly the threshold and not just under it', () => {
      const s = aside();
      const d = derive(s.cultivator);
      s.trial.lostMaxHp = d.maxHp / (1 + TRIAL_STRONGER) + 1e-6;
      expect(trialRetryDue(s)).toBe(false);
      s.trial.lostMaxHp = d.maxHp / (1 + TRIAL_STRONGER) - 1e-6;
      expect(trialRetryDue(s)).toBe(true);
    });

    it('queues the retry at the next kill once stat points make the cultivator stronger', () => {
      const s = aside();
      expect(trialRetryDue(s)).toBe(false);
      // The Path's primary stat drives damage.
      s.cultivator.stats[PATHS.sword.primary] += 20;
      expect(derive(s.cultivator).damage).toBeGreaterThanOrEqual(
        s.trial.lostDamage * (1 + TRIAL_STRONGER),
      );
      expect(trialRetryDue(s)).toBe(true);
      const queued = until(s, hasTribulation, 60);
      expect(queued.time).toBeLessThan(s.trial.lostAt + TRIAL_RETRY_SECONDS);
    });

    it('queues the retry once body makes max HP 5% higher', () => {
      const s = aside();
      s.cultivator.stats.body += 10;
      expect(derive(s.cultivator).maxHp).toBeGreaterThanOrEqual(
        s.trial.lostMaxHp * (1 + TRIAL_STRONGER),
      );
      expect(hasTribulation(until(s, hasTribulation, 60))).toBe(true);
    });
  });

  describe('Auto-Tribulation off', () => {
    it('takes a queued Tribulation off the floor and never queues it, nor passes the floor', () => {
      const s = setAutoTribulation(held(), false);
      expect(s.trial.auto).toBe(false);
      expect(hasTribulation(s)).toBe(false);
      const later = tick(s, 1800);
      expect(hasTribulation(later)).toBe(false);
      expect(later.floor).toBe(s.floor);
      expect(later.highestFloor).toBe(s.highestFloor);
      expect(later.cultivator.level).toBe(10);
      expect(characterStatus(later).kind).toBe('tribulationDue');
    });

    it('leaves a Tribulation being fought where it is', () => {
      const s = setAutoTribulation(faceTribulation(held()), false);
      expect(s.enemies[0]?.kind).toBe('tribulation');
    });

    it('still lets Face it start one, and counts its losses', () => {
      let s = setAutoTribulation(held(), false);
      expect(canFaceTribulation(s)).toBe(true);
      s = loseTrial(s);
      expect(s.trial.losses).toBe(1);
      expect(hasTribulation(s)).toBe(false);
      s = loseTimes(s, TRIAL_LOSS_LIMIT - 1);
      expect(trialSetAside(s)).toBe(true);
      // No automatic tries with the switch off, however long it waits.
      expect(trialRetryIn(s)).toBeNull();
      expect(hasTribulation(tick(s, TRIAL_RETRY_SECONDS * 2))).toBe(false);
    });

    it('queues it again when turned back on, by the same rules', () => {
      const off = setAutoTribulation(held(), false);
      expect(hasTribulation(setAutoTribulation(off, true))).toBe(true);
      const aside = setAutoTribulation(loseTimes(off, TRIAL_LOSS_LIMIT), true);
      expect(hasTribulation(aside)).toBe(false);
    });

    it('leaves the input state untouched', () => {
      const s = held();
      const copy = structuredClone(s);
      setAutoTribulation(s, false);
      expect(s).toEqual(copy);
    });
  });

  it('keeps the switch through Early Retirement, with no losses', () => {
    let s = setAutoTribulation(loseTimes(held(), TRIAL_LOSS_LIMIT), false);
    s = { ...s, highestFloor: 30, floor: 30 };
    const next = retire(s);
    expect(next.trial).toEqual({ auto: false, losses: 0, lostAt: 0, lostDamage: 0, lostMaxHp: 0 });
  });

  it('gives the same result for one big step as many small ones across a time retry', () => {
    const s = loseTimes(held(), TRIAL_LOSS_LIMIT);
    expect(run(s, TRIAL_RETRY_SECONDS + 300, 0.5)).toEqual(tick(s, TRIAL_RETRY_SECONDS + 300));
  });
});
