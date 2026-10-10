import { describe, expect, it } from 'vitest';
import { derive, PATHS, readyForTribulation, xpToNext, type PathId } from './cultivator.ts';
import { TRIBULATIONS } from './floors.ts';
import {
  arrayValue,
  equippedArray,
  namesFor,
  slotsFor,
  type ArrayId,
  type GradeId,
  type Item,
} from './loot.ts';
import { INVENTORY_SIZE, sellPrice } from './economy.ts';
import {
  ARRAY_TICK,
  canFaceTribulation,
  ENEMY_ARRIVAL,
  equip,
  faceTribulation,
  mitigate,
  newGame,
  tick,
  type GameState,
} from './sim.ts';

const PATH_IDS = Object.keys(PATHS) as PathId[];

function run(state: GameState, seconds: number, step: number): GameState {
  const steps = Math.round(seconds / step);
  for (let i = 0; i < steps; i++) state = tick(state, step);
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
  it.each(PATH_IDS)('gives %s the same result for one big step as many small ones', (path) => {
    const start = newGame(7, path);
    const big = tick(start, 3600);
    const small = run(start, 3600, 1);
    expect(big).toEqual(small);
    // A fractional step lands on the same events too.
    expect(run(start, 3600, 0.25)).toEqual(big);
  });

  it('matches one big step within tolerance for a step that is not exact in binary', () => {
    const start = newGame(7, 'sword');
    const big = tick(start, 3600);
    const small = run(start, 3600, 0.1);
    // Summing 0.1s drifts the clock by a hair; every event still lands the same.
    expect(small.time).toBeCloseTo(big.time, 6);
    expect({ ...small, time: 0 }).toEqual({ ...big, time: 0 });
  });

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
  it('picks up drops at the item level of the floor they fell on', () => {
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
  });

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
      expect(s.enemies.filter((e) => e.kind === 'tribulation')).toHaveLength(1);
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

  it('brings the Tribulation to the front at full HP, the interrupted enemy behind it', () => {
    const s = until(newGame(7, 'sword'), (x) => hasTribulation(x) && x.enemies.length > 2);
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

  it('faces the last realm cap, level 60, with its own Tribulation', () => {
    const s = newGame(7, 'sword');
    s.cultivator.level = 60;
    s.cultivator.xp = xpToNext(60);
    expect(canFaceTribulation(s)).toBe(true);
    const next = faceTribulation(s);
    expect(next.enemies[0]).toMatchObject({ kind: 'tribulation', name: TRIBULATIONS[5] });
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
    let s = until(newGame(7, 'sword'), (x) => hasTribulation(x) && x.enemies.length > 2);
    const { floor, deaths } = s;
    s = faceTribulation(s);
    s.enemies[0]!.damage = 1e9;
    s = until(s, (x) => x.deaths > deaths);
    expect(s.floor).toBe(floor);
    expect(s.cultivator.level).toBe(10);
    expect(canFaceTribulation(s)).toBe(true);
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
});

describe('Path balance', () => {
  /**
   * Rough fighting strength, to pick upgrades: damage per second times
   * toughness, with a disc's array counted too: a Killing Array adds its share
   * of damage every second, an Illusion Array cuts the hits taken, and a
   * Binding Array skips about delay / 2 s of a fight's enemy attacks (fights
   * run about ten seconds).
   */
  function power(state: GameState): number {
    const d = derive(state.cultivator);
    const array = equippedArray(state.cultivator.equipment);
    const share = (id: string) => (array?.id === id ? array.value : 0);
    const dps =
      (d.damage / d.attackInterval) * (1 + d.critChance * (d.critMultiplier - 1)) +
      (d.damage / d.attackInterval) * share('killing');
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
        for (const to of slotsFor((s.inventory[i] as Item).slot)) {
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

  it('keeps every Path within 15% of the others on the floor reached', () => {
    for (const minutes of [10, 60]) {
      const floors = PATH_IDS.map((path) => {
        let sum = 0;
        for (let seed = 1; seed <= SEEDS; seed++) sum += play(seed, path, minutes).highestFloor;
        return sum / SEEDS;
      });
      expect(Math.max(...floors) / Math.min(...floors)).toBeLessThan(1.15);
    }
  });
});
