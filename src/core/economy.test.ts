import { describe, expect, it } from 'vitest';
import { BASE_STAT, derive, PATHS, STARTING_PRIMARY_BONUS } from './cultivator.ts';
import {
  BAG_COST,
  BAG_ROW,
  bagCost,
  buyBagSpace,
  canResetStats,
  changePath,
  defaultFilter,
  essenceValue,
  INVENTORY_SIZE,
  keeps,
  killStones,
  MAX_BAG_SIZE,
  pathChangeCost,
  pickUp,
  resetStats,
  salvage,
  sell,
  sellBelow,
  sellBelowPreview,
  sellPrice,
  setFilter,
  SLOT_IDS,
  spendPoints,
  statResetCost,
  type LootFilter,
} from './economy.ts';
import type { GradeId, Item, SlotId } from './loot.ts';
import { catchUp } from './offline.ts';
import { equip, newGame, tick, type GameState } from './sim.ts';

function item(grade: GradeId, level = 1, slot: SlotId = 'weapon'): Item {
  return { slot, name: 'Iron Flying Sword', level, grade, baseRoll: 0.5, affixes: [] };
}

function game(bag: Item[] = [], stones = 0): GameState {
  return { ...newGame(3, 'sword'), inventory: bag, stones };
}

function filter(f: Partial<LootFilter>): LootFilter {
  return { ...defaultFilter(), ...f };
}

describe('prices', () => {
  it('sell and salvage pay out by grade and item level', () => {
    expect(sellPrice(item('mortal', 1))).toBe(2);
    expect(sellPrice(item('mortal', 10))).toBe(20);
    expect(sellPrice(item('earth', 10))).toBe(150);
    expect(sellPrice(item('immortal', 3))).toBe(450);
    expect(essenceValue(item('mortal', 1))).toBe(1);
    expect(essenceValue(item('heaven', 10))).toBe(120);
  });

  it('pays more for a better grade at the same level, and for a higher level', () => {
    const grades: GradeId[] = ['mortal', 'spirit', 'earth', 'heaven', 'immortal'];
    for (let i = 1; i < grades.length; i++) {
      const [lo, hi] = [item(grades[i - 1] as GradeId, 5), item(grades[i] as GradeId, 5)];
      expect(sellPrice(hi)).toBeGreaterThan(sellPrice(lo));
      expect(essenceValue(hi)).toBeGreaterThan(essenceValue(lo));
    }
    expect(sellPrice(item('spirit', 6))).toBeGreaterThan(sellPrice(item('spirit', 5)));
  });

  it('pays kill stones by enemy and floor, raised by stone find', () => {
    expect(killStones('demon', 1, 0)).toBe(1);
    expect(killStones('boss', 1, 0)).toBe(10);
    expect(killStones('boss', 11, 0)).toBe(20);
    expect(killStones('elite', 11, 0.5)).toBe(9);
  });
});

describe('sell and salvage', () => {
  it('sells a bag item for Spirit Stones', () => {
    const s = sell(game([item('mortal'), item('earth', 4)], 7), 1);
    expect(s.inventory).toEqual([item('mortal')]);
    expect(s.stones).toBe(7 + 60);
    expect(s.essence).toBe(0);
  });

  it('salvages a bag item into Spirit Essence', () => {
    const s = salvage(game([item('heaven', 2), item('mortal')]), 0);
    expect(s.inventory).toEqual([item('mortal')]);
    expect(s.essence).toBe(24);
    expect(s.stones).toBe(0);
  });

  it('leaves the input state untouched', () => {
    const start = game([item('spirit')]);
    const copy = structuredClone(start);
    sell(start, 0);
    salvage(start, 0);
    sellBelow(start, 'earth');
    expect(start).toEqual(copy);
  });

  it('rejects an index with no item', () => {
    const start = game([item('spirit')]);
    for (const i of [-1, 1, 0.5, Number.NaN]) {
      expect(() => sell(start, i)).toThrow(RangeError);
      expect(() => salvage(start, i)).toThrow(RangeError);
    }
  });
});

describe('equipped items', () => {
  const worn = (): GameState =>
    equip(game([item('immortal', 1), item('mortal'), item('spirit')]), 0);

  it('are never sold or salvaged', () => {
    const start = worn();
    const gear = structuredClone(start.cultivator.equipment);
    expect(gear.weapon).toEqual(item('immortal', 1));
    let s = sell(start, 0);
    s = salvage(s, 0);
    expect(s.cultivator.equipment).toEqual(gear);
    expect(s.inventory).toEqual([]);
    // Bulk selling below the top grade leaves the worn Immortal on.
    s = sellBelow(worn(), 'immortal');
    expect(s.cultivator.equipment).toEqual(gear);
    // An index past the bag is not a way to reach the equipment.
    expect(() => sell(start, 2)).toThrow(RangeError);
  });
});

describe('bulk sell', () => {
  const bag = [
    item('mortal', 2),
    item('earth', 1),
    item('spirit', 3),
    item('heaven'),
    item('mortal'),
  ];

  it('previews the count, the highest grade sold and the price', () => {
    expect(sellBelowPreview(game(bag), 'earth')).toEqual({
      count: 3,
      highest: 'spirit',
      stones: 4 + 15 + 2,
    });
    expect(sellBelowPreview(game(bag), 'immortal')).toMatchObject({ count: 5, highest: 'heaven' });
    expect(sellBelowPreview(game(bag), 'mortal')).toEqual({ count: 0, highest: null, stones: 0 });
  });

  it('sells exactly what the preview named, keeping the rest in order', () => {
    const s = sellBelow(game(bag, 10), 'earth');
    expect(s.inventory).toEqual([item('earth', 1), item('heaven')]);
    expect(s.stones).toBe(10 + 21);
  });
});

describe('auto filter', () => {
  it('keeps everything by default', () => {
    for (const g of ['mortal', 'immortal'] as const)
      expect(keeps(defaultFilter(), item(g))).toBe(true);
  });

  it('keeps by minimum grade and item type', () => {
    const f = filter({ minGrade: 'earth', slots: ['weapon', 'charm'] });
    expect(keeps(f, item('earth', 1, 'weapon'))).toBe(true);
    expect(keeps(f, item('immortal', 1, 'charm'))).toBe(true);
    expect(keeps(f, item('spirit', 1, 'weapon'))).toBe(false);
    expect(keeps(f, item('heaven', 1, 'head'))).toBe(false);
  });

  it.each([
    ['keeps', filter({ minGrade: 'earth' }), item('earth', 2), [item('earth', 2)], 0, 0],
    ['sells', filter({ minGrade: 'earth' }), item('spirit', 2), [], 10, 0],
    ['salvages', filter({ minGrade: 'earth', action: 'salvage' }), item('spirit', 2), [], 0, 4],
    ['sells off-type', filter({ slots: ['head'] }), item('heaven', 1), [], 40, 0],
  ] as const)('%s a drop on pickup', (_, f, drop, bag, stones, essence) => {
    const s = setFilter(game(), f);
    pickUp(s, drop);
    expect(s.inventory).toEqual(bag);
    expect([s.stones, s.essence]).toEqual([stones, essence]);
    expect(s.dropsSold).toBe(stones > 0 ? 1 : 0);
    expect(s.dropsSalvaged).toBe(essence > 0 ? 1 : 0);
  });

  it('sells a kept drop that does not fit, even when the filter salvages', () => {
    const full = Array.from({ length: INVENTORY_SIZE }, () => item('mortal'));
    const s = setFilter(game(full), filter({ action: 'salvage' }));
    pickUp(s, item('earth', 2));
    expect(s.inventory).toHaveLength(INVENTORY_SIZE);
    expect(s.stones).toBe(30);
    expect(s.dropsSold).toBe(1);
  });

  it('handles lower drops on pickup during play: "keep Earth and above"', () => {
    const s = tick(setFilter(newGame(5, 'sword'), filter({ minGrade: 'earth' })), 4 * 3600);
    expect(s.inventory.every((i) => i.grade !== 'mortal' && i.grade !== 'spirit')).toBe(true);
    expect(s.dropsSold).toBeGreaterThan(0);
    expect(s.dropsSalvaged).toBe(0);
  });

  it('keeps its item types in a fixed order without repeats', () => {
    const s = setFilter(game(), filter({ slots: ['charm', 'head', 'charm'] }));
    expect(s.filter.slots).toEqual(['head', 'charm']);
    expect(setFilter(game(), defaultFilter()).filter.slots).toEqual(SLOT_IDS);
  });
});

describe('Overtime Cultivation summary', () => {
  it('counts drops sold and salvaged during catch-up', () => {
    for (const action of ['sell', 'salvage'] as const) {
      const start = setFilter(newGame(5, 'sword'), filter({ minGrade: 'earth', action }));
      const { state, summary } = catchUp(start, 4 * 3600);
      expect(summary.dropsKept).toBe(state.inventory.length);
      expect(summary.dropsSold).toBe(state.dropsSold);
      expect(summary.dropsSalvaged).toBe(state.dropsSalvaged);
      expect(summary.stones).toBe(state.stones);
      expect(summary.essence).toBe(state.essence);
      if (action === 'sell') expect(summary.dropsSold).toBeGreaterThan(0);
      else expect(summary.dropsSalvaged).toBeGreaterThan(0);
    }
  });

  it('counts a full bag’s sales during catch-up', () => {
    const full = Array.from({ length: INVENTORY_SIZE }, () => item('mortal'));
    const { summary } = catchUp(game(full), 3600);
    expect(summary.dropsKept).toBe(0);
    expect(summary.dropsSold).toBeGreaterThan(0);
  });
});

describe('spending Spirit Stones', () => {
  it('a cost cannot be paid when unaffordable', () => {
    const s = game([], 0);
    const c = s.cultivator;
    expect(() => buyBagSpace({ ...s, stones: BAG_COST - 1 })).toThrow(RangeError);
    expect(() => changePath({ ...s, stones: pathChangeCost(c) - 1 }, 'body')).toThrow(RangeError);
    const levelled = tick(s, 600);
    const cost = statResetCost(levelled.cultivator);
    expect(() => resetStats({ ...levelled, stones: cost - 1 })).toThrow(RangeError);
  });

  it('buys bag space a row at a time, each dearer, up to the cap', () => {
    let s = game([], 1e9);
    let last = 0;
    while (bagCost(s) !== null) {
      const cost = bagCost(s) as number;
      expect(cost).toBeGreaterThan(last);
      const next = buyBagSpace(s);
      expect(next.bagSize).toBe(s.bagSize + BAG_ROW);
      expect(next.stones).toBe(s.stones - cost);
      [s, last] = [next, cost];
    }
    expect(s.bagSize).toBe(MAX_BAG_SIZE);
    expect(() => buyBagSpace(s)).toThrow(RangeError);
  });

  it('a bigger bag holds more drops', () => {
    const full = Array.from({ length: INVENTORY_SIZE }, () => item('mortal'));
    const s = buyBagSpace(game(full, BAG_COST));
    pickUp(s, item('spirit'));
    expect(s.inventory).toHaveLength(INVENTORY_SIZE + 1);
  });

  it('changes Path, putting every stat point into the new primary stat', () => {
    const start = tick(newGame(3, 'sword'), 3600);
    const s = changePath({ ...start, stones: pathChangeCost(start.cultivator) }, 'body');
    const c = s.cultivator;
    expect(c.path).toBe('body');
    expect(s.stones).toBe(0);
    const extra = STARTING_PRIMARY_BONUS + 3 * (c.level - 1);
    expect(c.stats).toEqual({ body: BASE_STAT + extra, agility: BASE_STAT, spirit: BASE_STAT });
    expect(c.hp).toBeLessThanOrEqual(derive(c).maxHp);
    expect(() => changePath({ ...s, stones: 1e9 }, 'body')).toThrow(RangeError);
  });

  it('resets stat points to spend by choice, and spends them', () => {
    const start = tick(newGame(3, 'talisman'), 3600);
    const points = start.cultivator.stats.spirit - BASE_STAT;
    let s = resetStats({ ...start, stones: statResetCost(start.cultivator) });
    expect(s.stones).toBe(0);
    expect(s.cultivator.unspent).toBe(points);
    expect(s.cultivator.stats).toEqual({ body: BASE_STAT, agility: BASE_STAT, spirit: BASE_STAT });
    expect(s.cultivator.hp).toBeLessThanOrEqual(derive(s.cultivator).maxHp);
    s = spendPoints(s, 'body', 2);
    s = spendPoints(s, 'agility', points - 2);
    expect(s.cultivator.unspent).toBe(0);
    expect(s.cultivator.stats).toEqual({
      body: BASE_STAT + 2,
      agility: BASE_STAT + points - 2,
      spirit: BASE_STAT,
    });
    expect(() => spendPoints(s, 'body', 1)).toThrow(RangeError);
  });

  it('refuses a reset that would change nothing, instead of charging for it', () => {
    const once = resetStats({ ...tick(newGame(3, 'body'), 600), stones: 1e9 });
    expect(canResetStats(once.cultivator)).toBe(false);
    expect(() => resetStats(once)).toThrow(RangeError);
    expect(canResetStats(spendPoints(once, 'spirit', 1).cultivator)).toBe(true);
  });

  it('refuses a filter or bulk sell the save would reject', () => {
    const s = game([item('mortal')]);
    const bad = [
      filter({ minGrade: 'x' as GradeId }),
      filter({ minGrade: 'earth\u200b' as GradeId }),
      filter({ action: 'burn' as 'sell' }),
      filter({ action: 'sell\u200b' as 'sell' }),
      filter({ slots: ['cape' as SlotId] }),
      filter({ slots: ['__proto__' as SlotId] }),
    ];
    for (const f of bad) expect(() => setFilter(s, f)).toThrow(RangeError);
    for (const g of ['x', 'h\u0435aven', 'toString']) {
      expect(() => sellBelow(s, g as GradeId)).toThrow(RangeError);
    }
  });

  it('caps currencies at the largest whole number a save holds', () => {
    const rich = game([item('immortal', 50)], Number.MAX_SAFE_INTEGER - 1);
    expect(sell(rich, 0).stones).toBe(Number.MAX_SAFE_INTEGER);
    const s = { ...rich, essence: Number.MAX_SAFE_INTEGER };
    expect(salvage(s, 0).essence).toBe(Number.MAX_SAFE_INTEGER);
    expect(tick(rich, 60).stones).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects a bad spend', () => {
    const s = resetStats({ ...tick(newGame(3, 'body'), 600), stones: 1e9 });
    const n = s.cultivator.unspent;
    for (const bad of [0, -1, 0.5, Number.NaN, n + 1]) {
      expect(() => spendPoints(s, 'body', bad)).toThrow(RangeError);
    }
    expect(() => spendPoints(s, 'luck' as 'body', 1)).toThrow(RangeError);
    expect(() => changePath(s, 'ninja' as 'body')).toThrow(RangeError);
  });

  it('level-ups still go to the primary stat while points are unspent', () => {
    const start = resetStats({ ...newGame(3, 'sword'), stones: 1e9 });
    const s = tick(start, 1800);
    expect(s.cultivator.level).toBeGreaterThan(1);
    expect(s.cultivator.unspent).toBe(start.cultivator.unspent);
    expect(s.cultivator.stats.agility).toBe(BASE_STAT + 3 * (s.cultivator.level - 1));
    expect(PATHS[s.cultivator.path].primary).toBe('agility');
  });
});
