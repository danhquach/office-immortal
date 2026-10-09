import { describe, expect, it } from 'vitest';
import { derive, PATHS, type PathId } from './cultivator.ts';
import type { Item } from './loot.ts';
import { equip, INVENTORY_SIZE, mitigate, newGame, tick, type GameState } from './sim.ts';

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

  it.each(PATH_IDS)('walls %s at a higher floor and drops it back one', (path) => {
    let s = newGame(5, path);
    for (let t = 0; t < 4 * 3600 && s.deaths === 0; t++) {
      const before = s;
      s = tick(s, 1);
      if (s.deaths > 0) {
        expect(before.floor).toBeGreaterThan(1);
        expect(s.floor).toBe(before.floor - 1);
        expect(s.highestFloor).toBe(before.floor);
        expect(s.cultivator.hp).toBeGreaterThan(0);
      }
    }
    expect(s.deaths).toBeGreaterThan(0);
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
  return { slot: 'weapon', name: 'Jade Stapler', level, grade: 'mortal', baseRoll, affixes: [] };
}

function withBag(state: GameState, items: Item[]): GameState {
  return { ...structuredClone(state), inventory: items };
}

describe('drops', () => {
  it('picks up drops at the item level of the floor they fell on', () => {
    // Steps short enough for one kill each, through deaths that drop a floor.
    let s = newGame(21, 'sword');
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

  it('stops picking up when the bag is full and counts what was lost', () => {
    const full = withBag(
      newGame(21, 'sword'),
      Array.from({ length: INVENTORY_SIZE }, () => weapon(1, 0)),
    );
    const s = tick(full, 1800);
    expect(s.inventory).toHaveLength(INVENTORY_SIZE);
    expect(s.dropsLost).toBeGreaterThan(0);
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

  it('never leaves HP above a lower max HP', () => {
    const pendant: Item = {
      slot: 'pendant',
      name: 'Lanyard Pendant',
      level: 50,
      grade: 'mortal',
      baseRoll: 1,
      affixes: [],
    };
    let s = equip(withBag(newGame(1, 'body'), [pendant]), 0);
    s.cultivator.hp = derive(s.cultivator).maxHp;
    s = equip({ ...s, inventory: [{ ...pendant, level: 1 }] }, 0);
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
