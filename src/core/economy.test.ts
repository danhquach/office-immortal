import { describe, expect, it } from 'vitest';
import { BASE_STAT, derive, PATHS, STARTING_PRIMARY_BONUS } from './cultivator.ts';
import {
  BAG_COST,
  ESSENCE_VALUE,
  GRADE_IDS,
  refine,
  REFINE_COST_MULT,
  REFINE_WEIGHT_TOTAL,
  REFINE_WEIGHTS_HIGH,
  REFINE_WEIGHTS_LOW,
  refineCost,
  refineGain,
  refineReach,
  refineWeights,
  rerollAffix,
  REROLL_COST_MULT,
  rerollCost,
  BAG_ROW,
  bagCost,
  buyBagSpace,
  bagStillShows,
  bulkConfirm,
  bulkPreview,
  bulkTake,
  type BulkAction,
  canResetStats,
  changePath,
  defaultFilter,
  disposeItem,
  essenceValue,
  INVENTORY_SIZE,
  keeps,
  killStones,
  MAX_BAG_SIZE,
  pathChangeCost,
  pickUp,
  resetStats,
  sellPrice,
  setFilter,
  SLOT_IDS,
  spendPoints,
  statResetCost,
  type LootFilter,
} from './economy.ts';
import {
  AFFIXES,
  drawAffixes,
  favouredAffixes,
  MAX_REFINES,
  namesFor,
  PATH_FAVOURS,
  type AffixId,
  type GradeId,
  type Item,
  type SlotId,
} from './loot.ts';
import { catchUp } from './offline.ts';
import { createRng, rngFrom } from './rng.ts';
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
    const s = disposeItem(game([item('mortal'), item('earth', 4)], 7), 1, 'sell');
    expect(s.inventory).toEqual([item('mortal')]);
    expect(s.stones).toBe(7 + 60);
    expect(s.essence).toBe(0);
  });

  it('salvages a bag item into Spirit Essence', () => {
    const s = disposeItem(game([item('heaven', 2), item('mortal')]), 0, 'salvage');
    expect(s.inventory).toEqual([item('mortal')]);
    expect(s.essence).toBe(24);
    expect(s.stones).toBe(0);
  });

  it('leaves the input state untouched', () => {
    const start = game([item('spirit')]);
    const copy = structuredClone(start);
    disposeItem(start, 0, 'sell');
    disposeItem(start, 0, 'salvage');
    bulkTake(start, 'sell', 'earth');
    bulkTake(start, 'salvage', 'earth');
    expect(start).toEqual(copy);
  });

  it('rejects an index with no item', () => {
    const start = game([item('spirit')]);
    for (const i of [-1, 1, 0.5, Number.NaN]) {
      expect(() => disposeItem(start, i, 'sell')).toThrow(RangeError);
      expect(() => disposeItem(start, i, 'salvage')).toThrow(RangeError);
    }
  });
});

describe('equipped items', () => {
  const worn = (): GameState => {
    const s = game([item('immortal', 1), item('mortal'), item('spirit')]);
    s.cultivator.level = 21; // An Immortal Treasure needs Golden Core.
    return equip(s, 0);
  };

  it('are never sold or salvaged', () => {
    const start = worn();
    const gear = structuredClone(start.cultivator.equipment);
    expect(gear.weapon).toEqual(item('immortal', 1));
    let s = disposeItem(start, 0, 'sell');
    s = disposeItem(s, 0, 'salvage');
    expect(s.cultivator.equipment).toEqual(gear);
    expect(s.inventory).toEqual([]);
    // Bulk selling below the top grade leaves the worn Immortal on.
    s = bulkTake(worn(), 'sell', 'immortal');
    expect(s.cultivator.equipment).toEqual(gear);
    // Bulk salvage leaves it on too, and never counts or pays for it.
    expect(bulkPreview(worn(), 'salvage', 'immortal')).toMatchObject({
      count: 2,
      highest: 'spirit',
    });
    s = bulkTake(worn(), 'salvage', 'immortal');
    expect(s.cultivator.equipment).toEqual(gear);
    expect(s.inventory).toEqual([]);
    expect(s.essence).toBe(essenceValue(item('mortal')) + essenceValue(item('spirit')));
    // An index past the bag is not a way to reach the equipment.
    expect(() => disposeItem(start, 2, 'sell')).toThrow(RangeError);
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
    expect(bulkPreview(game(bag), 'sell', 'earth')).toEqual({
      count: 3,
      highest: 'spirit',
      total: 4 + 15 + 2,
      kept: 0,
    });
    expect(bulkPreview(game(bag), 'sell', 'immortal')).toMatchObject({
      count: 5,
      highest: 'heaven',
    });
    expect(bulkPreview(game(bag), 'sell', 'mortal')).toEqual({
      count: 0,
      highest: null,
      total: 0,
      kept: 0,
    });
  });

  it('sells exactly what the preview named, keeping the rest in order', () => {
    const s = bulkTake(game(bag, 10), 'sell', 'earth');
    expect(s.inventory).toEqual([item('earth', 1), item('heaven')]);
    expect(s.stones).toBe(10 + 21);
  });

  it('keeps refined items below the grade, and counts and prices only what it sells', () => {
    const refined = (i: Item, n: number): Item => ({ ...i, refines: n });
    const mixed = [
      item('mortal', 2),
      refined(item('spirit', 3), 1),
      item('earth', 1),
      refined(item('mortal', 5), 12),
      item('mortal'),
    ];
    // Only the two plain Mortals go: the refined Spirit is not the highest sold.
    expect(bulkPreview(game(mixed), 'sell', 'earth')).toEqual({
      count: 2,
      highest: 'mortal',
      total: 4 + 2,
      kept: 2,
    });
    const s = bulkTake(game(mixed, 10), 'sell', 'earth');
    expect(s.inventory).toEqual([mixed[1], mixed[2], mixed[3]]);
    expect(s.stones).toBe(10 + 6);
    // Nothing but refined items below: nothing sold, both kept.
    const onlyRefined = [refined(item('mortal'), 1), item('heaven')];
    expect(bulkPreview(game(onlyRefined), 'sell', 'spirit')).toEqual({
      count: 0,
      highest: null,
      total: 0,
      kept: 1,
    });
    expect(bulkTake(game(onlyRefined), 'sell', 'spirit').inventory).toEqual(onlyRefined);
  });

  it('names the action when there is no item to dispose of', () => {
    expect(() => disposeItem(game([item('earth')]), 1, 'salvage')).toThrow(
      /^salvage: no item at 1$/,
    );
  });

  it('still sells or salvages a refined item one at a time', () => {
    const one = [{ ...item('earth', 4), refines: 3 }];
    expect(disposeItem(game(one), 0, 'sell').stones).toBe(60);
    expect(disposeItem(game(one), 0, 'salvage').essence).toBe(20);
  });
});

describe('bulk salvage', () => {
  const bag = [
    item('mortal', 2),
    item('earth', 1),
    item('spirit', 3),
    item('heaven'),
    item('mortal'),
  ];
  const refined = (i: Item, n: number): Item => ({ ...i, refines: n });

  it('previews the count, the highest grade salvaged and the Spirit Essence', () => {
    expect(bulkPreview(game(bag), 'salvage', 'earth')).toEqual({
      count: 3,
      highest: 'spirit',
      total: essenceValue(bag[0] as Item) + essenceValue(bag[2] as Item) + 1,
      kept: 0,
    });
    expect(bulkPreview(game(bag), 'salvage', 'immortal')).toMatchObject({
      count: 5,
      highest: 'heaven',
      total: bag.reduce((n, i) => n + essenceValue(i), 0),
    });
  });

  it('salvages exactly what the preview named into essence, keeping the rest in order', () => {
    const start = { ...game(bag, 10), essence: 5 };
    const preview = bulkPreview(start, 'salvage', 'earth');
    const s = bulkTake(start, 'salvage', 'earth');
    expect(s.inventory).toEqual([item('earth', 1), item('heaven')]);
    expect(s.essence).toBe(5 + preview.total);
    // Salvage pays essence, never stones.
    expect(s.stones).toBe(10);
  });

  it('takes the same items bulk sell would', () => {
    const mixed = [item('mortal', 2), refined(item('spirit', 3), 1), item('earth'), item('mortal')];
    for (const g of GRADE_IDS) {
      expect(bulkTake(game(mixed), 'salvage', g).inventory).toEqual(
        bulkTake(game(mixed), 'sell', g).inventory,
      );
    }
  });

  it('keeps refined items below the grade, counting and paying only what it salvages', () => {
    const mixed = [
      item('mortal', 2),
      refined(item('spirit', 3), 1),
      item('earth', 1),
      refined(item('mortal', 5), 12),
      item('mortal'),
    ];
    expect(bulkPreview(game(mixed), 'salvage', 'earth')).toEqual({
      count: 2,
      highest: 'mortal',
      total: essenceValue(item('mortal', 2)) + essenceValue(item('mortal')),
      kept: 2,
    });
    const s = bulkTake(game(mixed), 'salvage', 'earth');
    expect(s.inventory).toEqual([mixed[1], mixed[2], mixed[3]]);
  });

  it('changes nothing when nothing is below the grade', () => {
    for (const bagged of [bag, [refined(item('mortal'), 1), item('heaven')], []]) {
      const start = { ...game(bagged, 3), essence: 4 };
      const grade = bagged === bag ? 'mortal' : 'spirit';
      expect(bulkPreview(start, 'salvage', grade)).toMatchObject({
        count: 0,
        highest: null,
        total: 0,
      });
      expect(bulkTake(start, 'salvage', grade)).toEqual(start);
    }
  });

  it('leaves the auto filter alone', () => {
    const start = setFilter(game(bag), filter({ minGrade: 'heaven', action: 'salvage' }));
    expect(bulkTake(start, 'salvage', 'immortal').filter).toEqual(start.filter);
  });

  it('caps essence at the largest whole number a save holds', () => {
    const rich = { ...game([item('heaven', 50)]), essence: Number.MAX_SAFE_INTEGER - 1 };
    expect(bulkTake(rich, 'salvage', 'immortal').essence).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('refuses a grade the save would reject', () => {
    const s = game([item('mortal')]);
    for (const g of [
      'x',
      'h\u0435aven',
      'toString',
      '__proto__',
      'earth\u200b',
      '\u202eearth',
      'x'.repeat(1e5),
    ]) {
      expect(() => bulkTake(s, 'salvage', g as GradeId)).toThrow(RangeError);
      // The bad grade never reaches the error message (or any log line it lands in).
      expect(() => bulkTake(s, 'salvage', g as GradeId)).toThrow(/^bulk salvage: unknown grade$/);
      expect(() => bulkTake(s, 'sell', g as GradeId)).toThrow(/^bulk sell: unknown grade$/);
      // The preview refuses it the same way, so the two never disagree.
      expect(() => bulkPreview(s, 'salvage', g as GradeId)).toThrow(
        /^bulk salvage: unknown grade$/,
      );
    }
  });
});

describe('bulk actions', () => {
  const bag = [item('mortal', 2), item('spirit'), item('heaven')];

  it('sell pays Spirit Stones and salvage pays Spirit Essence, for the same items', () => {
    const start = { ...game(bag, 1), essence: 2 };
    const sold = bulkTake(start, 'sell', 'earth');
    const salvaged = bulkTake(start, 'salvage', 'earth');
    expect(sold.inventory).toEqual([item('heaven')]);
    expect(salvaged.inventory).toEqual([item('heaven')]);
    expect([sold.stones, sold.essence]).toEqual([
      1 + sellPrice(bag[0] as Item) + sellPrice(item('spirit')),
      2,
    ]);
    expect([salvaged.stones, salvaged.essence]).toEqual([
      1,
      2 + essenceValue(bag[0] as Item) + essenceValue(item('spirit')),
    ]);
    expect(bulkPreview(start, 'sell', 'earth').total).toBe(sold.stones - 1);
    expect(bulkPreview(start, 'salvage', 'earth').total).toBe(salvaged.essence - 2);
  });

  it('looks only at the first `within` bag items, so a later drop is never taken', () => {
    // The player saw two items; a third, also below the grade, landed after.
    const s = game([item('mortal'), item('heaven'), item('spirit')]);
    expect(bulkPreview(s, 'salvage', 'earth', 2)).toEqual({
      count: 1,
      highest: 'mortal',
      total: 1,
      kept: 0,
    });
    expect(bulkTake(s, 'salvage', 'earth', 2).inventory).toEqual([item('heaven'), item('spirit')]);
    expect(bulkTake(s, 'salvage', 'earth', 0)).toEqual(s);
  });

  it('previews only what is credited once a currency is near its cap', () => {
    const rich = { ...game([item('heaven', 50)]), essence: Number.MAX_SAFE_INTEGER - 1 };
    const preview = bulkPreview(rich, 'salvage', 'immortal');
    expect(preview.total).toBe(1);
    expect(bulkTake(rich, 'salvage', 'immortal').essence).toBe(rich.essence + preview.total);
  });

  it('refuses an unknown action or a bag range it could not have seen, without echoing it', () => {
    const s = game([item('mortal')]);
    for (const a of ['burn', '__proto__', 'constructor', 'sell\u200b']) {
      expect(() => bulkPreview(s, a as BulkAction, 'earth')).toThrow(/^bulk: unknown action$/);
      expect(() => bulkTake(s, a as BulkAction, 'earth')).toThrow(/^bulk: unknown action$/);
    }
    for (const w of [-1, 2, 0.5, Number.NaN, Infinity]) {
      expect(() => bulkPreview(s, 'sell', 'earth', w)).toThrow(/^bulk sell: bad bag range$/);
      expect(() => bulkTake(s, 'salvage', 'earth', w)).toThrow(/^bulk salvage: bad bag range$/);
    }
  });
});

describe('bulk confirmation', () => {
  it('takes what it showed and leaves drops that landed since', () => {
    const start = game([item('mortal'), item('heaven')]);
    const seen = start.inventory;
    const preview = bulkPreview(start, 'salvage', 'earth');
    const later = { ...start, inventory: [...start.inventory, item('spirit')] };
    const s = bulkConfirm(structuredClone(later), 'salvage', 'earth', seen);
    expect(s?.inventory).toEqual([item('heaven'), item('spirit')]);
    expect(s?.essence).toBe(preview.total);
  });

  it('takes nothing when the part it showed changed, even if the numbers match', () => {
    const seen = [item('mortal'), item('heaven')];
    // The Mortal was sold on its own and a look-alike landed at the end.
    const swapped = game([item('heaven'), item('mortal')]);
    expect(bulkConfirm(swapped, 'salvage', 'earth', seen)).toBeNull();
    expect(bulkConfirm(game([item('mortal')]), 'salvage', 'earth', seen)).toBeNull();
    const refined = game([{ ...item('mortal'), refines: 1 }, item('heaven')]);
    expect(bulkConfirm(refined, 'salvage', 'earth', seen)).toBeNull();
  });

  it('takes nothing when there is nothing to take', () => {
    const none = game([item('heaven')]);
    expect(bulkConfirm(none, 'sell', 'earth', none.inventory)).toBeNull();
  });

  it('goes through near a currency cap, crediting only what fits, so it never keeps asking', () => {
    const near = { ...game([item('heaven', 50)]), essence: Number.MAX_SAFE_INTEGER - 5 };
    const seen = near.inventory;
    expect(bulkPreview(near, 'salvage', 'immortal').total).toBe(5);
    // Kills and drops kept paying while the box was open.
    const richer = { ...near, essence: near.essence + 2 };
    expect(bulkConfirm(richer, 'salvage', 'immortal', seen)).toMatchObject({
      inventory: [],
      essence: Number.MAX_SAFE_INTEGER,
    });
  });

  it('compares items by value, NaN included, so a bad field never makes it ask forever', () => {
    const odd = [{ ...item('mortal'), baseRoll: Number.NaN }];
    expect(bagStillShows(game(structuredClone(odd)), odd)).toBe(true);
    expect(bagStillShows(game([]), odd)).toBe(false);
  });

  it('compares a save-parsed item with an own __proto__ key without polluting or matching', () => {
    const hostile = JSON.parse(
      JSON.stringify(item('mortal')).replace(/^\{/, '{"__proto__":{"polluted":true},'),
    ) as Item;
    expect(bagStillShows(game([hostile]), [item('mortal')])).toBe(false);
    expect(bagStillShows(game([item('mortal')]), [hostile])).toBe(false);
    expect(bagStillShows(game([hostile]), [structuredClone(hostile)])).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses hostile actions and grades like the other bulk paths', () => {
    const s = game([item('mortal')]);
    for (const a of ['__proto__', 'constructor', 'toString', 'burn']) {
      expect(() => bulkConfirm(s, a as BulkAction, 'earth', s.inventory)).toThrow(RangeError);
      expect(() => disposeItem(s, 0, a as BulkAction)).toThrow(/^dispose: unknown action$/);
    }
    for (const g of ['x', '__proto__', 'h\u0435aven', 'x'.repeat(1e5)]) {
      expect(() => bulkConfirm(s, 'salvage', g as GradeId, s.inventory)).toThrow(
        /^bulk salvage: unknown grade$/,
      );
    }
  });

  it('matches items whatever their key order, as a save load may rebuild them', () => {
    const seen = [item('mortal')];
    const { slot, ...rest } = item('mortal');
    const reordered = game([{ ...rest, slot } as Item]);
    expect(bulkConfirm(reordered, 'salvage', 'earth', seen)?.inventory).toEqual([]);
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

  it('keeps qi within max qi when a Path change or a stat reset shrinks it', () => {
    const s = { ...game([], 1e9) };
    const c = s.cultivator;
    c.path = 'talisman';
    c.stats = { body: BASE_STAT, agility: BASE_STAT, spirit: BASE_STAT + 200 };
    c.qi = derive(c).maxQi;
    const moved = changePath(s, 'body');
    expect(moved.cultivator.qi).toBe(derive(moved.cultivator).maxQi);
    expect(moved.cultivator.qi).toBeLessThan(c.qi);
    const reset = resetStats(s);
    expect(reset.cultivator.qi).toBe(derive(reset.cultivator).maxQi);
    expect(reset.cultivator.qi).toBeLessThan(c.qi);
  });

  it('spends only Spirit Stones, never Spirit Essence', () => {
    const s = { ...game([], 1e9), essence: 77 };
    expect(buyBagSpace(s).essence).toBe(77);
    expect(changePath(s, 'body').essence).toBe(77);
    // Essence never pays a Spirit Stone cost.
    expect(() => buyBagSpace({ ...s, stones: 0, essence: 1e9 })).toThrow(RangeError);
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
      expect(() => bulkTake(s, 'sell', g as GradeId)).toThrow(RangeError);
    }
  });

  it('caps currencies at the largest whole number a save holds', () => {
    const rich = game([item('immortal', 50)], Number.MAX_SAFE_INTEGER - 1);
    expect(disposeItem(rich, 0, 'sell').stones).toBe(Number.MAX_SAFE_INTEGER);
    const s = { ...rich, essence: Number.MAX_SAFE_INTEGER };
    expect(disposeItem(s, 0, 'salvage').essence).toBe(Number.MAX_SAFE_INTEGER);
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

describe('crafting', () => {
  const AFFIX_IDS = Object.keys(AFFIXES) as AffixId[];
  /** A Spirit sword-family weapon (favours crit chance, crit damage, attack speed). */
  function sword(affixes: AffixId[], baseRoll = 0.5, extra: Partial<Item> = {}): Item {
    return {
      slot: 'weapon',
      name: 'Azure Cloud Flying Sword',
      level: 10,
      grade: 'spirit',
      baseRoll,
      affixes: affixes.map((id) => ({ id, roll: 0.4 })),
      ...extra,
    };
  }
  function rich(bag: Item[], essence = 1e9, seed = 3): GameState {
    return { ...newGame(seed, 'sword'), inventory: bag, essence };
  }

  describe('costs', () => {
    it('refine costs 2× and reroll 3× the salvage value, by grade and item level', () => {
      expect(REFINE_COST_MULT).toBe(2);
      expect(REROLL_COST_MULT).toBe(3);
      for (const g of GRADE_IDS) {
        for (const level of [1, 40]) {
          const it = item(g, level);
          expect(refineCost(it), g).toBe(2 * ESSENCE_VALUE[g] * level);
          expect(rerollCost(it), g).toBe(3 * ESSENCE_VALUE[g] * level);
          expect(refineCost(it)).toBe(2 * essenceValue(it));
        }
      }
      // The issue's example: a Heaven Lv 40 item salvages for 480 and refines for 960.
      expect(essenceValue(item('heaven', 40))).toBe(480);
      expect(refineCost(item('heaven', 40))).toBe(960);
      expect(rerollCost(item('heaven', 40))).toBe(1440);
    });
  });

  describe('refine weights', () => {
    it('blends the two tables: LOW at 0%, HIGH at 100%', () => {
      expect(REFINE_WEIGHTS_LOW).toEqual([25, 20, 15, 10, 8, 7, 5, 4, 3, 3]);
      expect(REFINE_WEIGHTS_HIGH).toEqual([50, 25, 12, 5, 3, 2, 1, 1, 1, 0]);
      expect(refineWeights(0)).toEqual(REFINE_WEIGHTS_LOW.map((w) => w * 100));
      expect(refineWeights(100)).toEqual(REFINE_WEIGHTS_HIGH.map((w) => w * 100));
      expect(refineWeights(50)[0]).toBe(25 * 50 + 50 * 50);
    });

    it('sums to 10 000 for every roll, all whole and none negative', () => {
      expect(REFINE_WEIGHT_TOTAL).toBe(10_000);
      for (let p = 0; p <= 100; p++) {
        const w = refineWeights(p);
        expect(w).toHaveLength(10);
        expect(
          w.reduce((a, b) => a + b, 0),
          `p=${p}`,
        ).toBe(10_000);
        for (const x of w) expect(Number.isInteger(x) && x >= 0).toBe(true);
      }
    });

    it('makes +1 likelier and the average gain smaller as the roll climbs', () => {
      const mean = (p: number) =>
        refineWeights(p).reduce((sum, w, i) => sum + w * (i + 1), 0) / REFINE_WEIGHT_TOTAL;
      for (let p = 1; p <= 99; p++) {
        expect(refineWeights(p)[0], `p=${p}`).toBeGreaterThanOrEqual(refineWeights(p - 1)[0]!);
        expect(mean(p), `p=${p}`).toBeLessThanOrEqual(mean(p - 1));
      }
      // The issue's table of average gains.
      expect(mean(0)).toBeCloseTo(3.56, 2);
      expect(mean(50)).toBeCloseTo(2.81, 2);
      expect(mean(75)).toBeCloseTo(2.44, 2);
      expect(mean(90)).toBeCloseTo(2.22, 2);
    });

    it('rejects a roll that is not a whole 0 to 100', () => {
      for (const p of [-1, 101, 0.5, Number.NaN, Infinity]) {
        expect(() => refineWeights(p)).toThrow(RangeError);
      }
    });

    it.each([
      [0, 0.6, 0.3, 0.1],
      [50, 0.735, 0.2, 0.065],
      [90, 0.84, 0.13, 0.03],
    ])('draws gains at %i%% as the table says over many seeded draws', (p, small, mid, big) => {
      const rng = createRng(p + 17);
      const n = 40_000;
      const counts = Array.from({ length: 11 }, () => 0);
      for (let i = 0; i < n; i++) counts[refineGain(rng, p)]! += 1;
      expect(counts[0]).toBe(0);
      const share = (from: number, to: number) =>
        counts.slice(from, to + 1).reduce((a, b) => a + b, 0) / n;
      expect(share(1, 3)).toBeCloseTo(small, 1);
      expect(share(4, 7)).toBeCloseTo(mid, 1);
      expect(share(8, 10)).toBeCloseTo(big, 1);
      // Each gain within a point of its exact weight.
      refineWeights(p).forEach((w, i) => {
        expect(Math.abs((counts[i + 1] as number) / n - w / REFINE_WEIGHT_TOTAL)).toBeLessThan(
          0.01,
        );
      });
    });

    it('picks with one int(rng, 1, 10000) on the cumulative weights', () => {
      // A source that returns just under 1 lands on the last gain with weight.
      expect(refineGain(() => 0, 0)).toBe(1);
      expect(refineGain(() => 0.9999999, 0)).toBe(10);
      expect(refineGain(() => 0.9999999, 100)).toBe(9);
      // 2500 / 10000 at 0% is the last +1.
      expect(refineGain(() => 2499 / 10_000, 0)).toBe(1);
      expect(refineGain(() => 2500 / 10_000, 0)).toBe(2);
    });
  });

  describe('refine', () => {
    it('raises the base roll by 1 to 10 points, spends the cost and adds a refine level', () => {
      for (let seed = 0; seed < 300; seed++) {
        const start = rich([sword(['maxHp'], 0.37)], 5000, seed);
        const s = refine(start, { bag: 0 });
        const after = s.inventory[0] as Item;
        const gain = Math.round(after.baseRoll * 100) - 37;
        expect(gain).toBeGreaterThanOrEqual(1);
        expect(gain).toBeLessThanOrEqual(10);
        expect(after.baseRoll).toBe(Math.round(after.baseRoll * 100) / 100);
        expect(s.essence).toBe(5000 - refineCost(start.inventory[0] as Item));
        expect(after.refines).toBe(1);
        // Only the base roll and the refine level change.
        expect({ ...after, baseRoll: 0.37, refines: undefined }).toEqual({
          ...sword(['maxHp'], 0.37),
          refines: undefined,
        });
      }
    });

    it('caps at 100%, never lowers the roll, and stops once fully refined', () => {
      let s = rich([sword([], 0.95)]);
      for (let i = 0; i < 6 && refineReach(s.inventory[0] as Item); i++) {
        const before = (s.inventory[0] as Item).baseRoll;
        s = refine(s, { bag: 0 });
        const now = (s.inventory[0] as Item).baseRoll;
        expect(now).toBeGreaterThan(before);
        expect(now).toBeLessThanOrEqual(1);
      }
      expect((s.inventory[0] as Item).baseRoll).toBe(1);
      expect(refineReach(s.inventory[0] as Item)).toBeNull();
      expect(() => refine(s, { bag: 0 })).toThrow(RangeError);
    });

    it('takes an item from 0% to 100% in at most 100 refines, its level counting each', () => {
      let s = rich([sword([], 0)]);
      let n = 0;
      while (refineReach(s.inventory[0] as Item)) {
        s = refine(s, { bag: 0 });
        n += 1;
        expect((s.inventory[0] as Item).refines).toBe(n);
      }
      expect(n).toBeLessThanOrEqual(MAX_REFINES);
      expect((s.inventory[0] as Item).baseRoll).toBe(1);
    });

    it('never takes the refine level past 100', () => {
      const s = refine(rich([sword([], 0.5, { refines: MAX_REFINES })]), { bag: 0 });
      expect((s.inventory[0] as Item).refines).toBe(MAX_REFINES);
    });

    it('shows the reachable base rolls before paying', () => {
      expect(refineReach(sword([], 0.62))).toEqual([63, 72]);
      expect(refineReach(sword([], 0.95))).toEqual([96, 100]);
      expect(refineReach(sword([], 0.99))).toEqual([100, 100]);
      expect(refineReach(sword([], 1))).toBeNull();
    });

    it('works on an equipped item, and on a disc raises its array strength', () => {
      const disc: Item = {
        slot: 'attachment',
        name: 'Bronze Formation Disc',
        level: 3,
        grade: 'mortal',
        baseRoll: 0.2,
        affixes: [],
        array: 'illusion',
      };
      const worn = equip(rich([disc]), 0);
      const s = refine(worn, { slot: 'attachment' });
      const after = s.cultivator.equipment.attachment as Item;
      expect(after.baseRoll).toBeGreaterThan(0.2);
      expect(after.array).toBe('illusion');
      expect(after.refines).toBe(1);
      expect(s.essence).toBe(worn.essence - refineCost(disc));
    });

    it('is the same for the same seed and leaves the input untouched', () => {
      const start = rich([sword(['maxHp'], 0.1)]);
      const copy = structuredClone(start);
      const a = refine(start, { bag: 0 });
      expect(start).toEqual(copy);
      expect(refine(start, { bag: 0 })).toEqual(a);
      // It advances the sim's stream.
      expect(a.rng.s).not.toBe(start.rng.s);
      // Another seed lands elsewhere at least once.
      const others = Array.from({ length: 20 }, (_, i) =>
        refine({ ...start, rng: { s: i } }, { bag: 0 }),
      );
      expect(new Set(others.map((o) => o.inventory[0]?.baseRoll)).size).toBeGreaterThan(1);
    });

    it('rejects too little Essence, a full roll and any bad place', () => {
      const it = sword(['maxHp']);
      const cost = refineCost(it);
      expect(() => refine(rich([it], cost - 1), { bag: 0 })).toThrow(RangeError);
      expect(refine(rich([it], cost), { bag: 0 }).essence).toBe(0);
      expect(() => refine(rich([sword([], 1)]), { bag: 0 })).toThrow(RangeError);
      const s = rich([it]);
      for (const bag of [-1, 1, 0.5, Number.NaN]) {
        expect(() => refine(s, { bag })).toThrow(RangeError);
      }
      for (const slot of ['weapon', 'nope', '__proto__', 'constructor']) {
        expect(() => refine(s, { slot } as { slot: 'weapon' })).toThrow(RangeError);
      }
    });
  });

  describe('reroll', () => {
    it('keeps HP within the new max when a worn Max HP affix is rerolled at full HP', () => {
      const cap: Item = {
        slot: 'head',
        name: namesFor('head', 'spirit')[0] as string,
        level: 20,
        grade: 'spirit',
        baseRoll: 0.5,
        affixes: [{ id: 'maxHp', roll: 1 }],
      };
      let lowered = 0;
      for (let seed = 0; seed < 40; seed++) {
        const worn = equip(rich([cap], 1e6, seed), 0);
        worn.cultivator.hp = derive(worn.cultivator).maxHp;
        const s = rerollAffix(worn, { slot: 'head' }, 0);
        const max = derive(s.cultivator).maxHp;
        expect(s.cultivator.hp).toBeLessThanOrEqual(max);
        expect(s.cultivator.hp).toBeGreaterThan(0);
        if (max < worn.cultivator.hp) lowered += 1;
      }
      // Most rerolls lose the top Max HP roll, so the clamp is exercised.
      expect(lowered).toBeGreaterThan(0);
    });

    it('replaces only the chosen affix, never with another one the item has', () => {
      const ids: AffixId[] = ['critChance', 'maxHp'];
      for (let seed = 0; seed < 300; seed++) {
        const start = rich([sword(ids, 0.3, { refines: 4 })], 1e6, seed);
        const s = rerollAffix(start, { bag: 0 }, 1);
        const after = s.inventory[0] as Item;
        expect(after.affixes).toHaveLength(2);
        expect(after.affixes[0]).toEqual({ id: 'critChance', roll: 0.4 });
        const fresh = after.affixes[1]!;
        expect(fresh.id).not.toBe('critChance');
        expect(AFFIX_IDS).toContain(fresh.id);
        expect(fresh.roll).toBe(Math.round(fresh.roll * 100) / 100);
        expect(fresh.roll).toBeGreaterThanOrEqual(0);
        expect(fresh.roll).toBeLessThanOrEqual(1);
        // Base roll, grade, level, name and refine level are kept.
        expect({ ...after, affixes: [] }).toEqual({ ...sword([], 0.3, { refines: 4 }) });
        expect(s.essence).toBe(1e6 - rerollCost(after));
      }
    });

    it('may land on the same affix again, with a new roll', () => {
      const seen = new Set<AffixId>();
      for (let seed = 0; seed < 200; seed++) {
        seen.add(
          rerollAffix(rich([sword(['maxHp'])], 1e6, seed), { bag: 0 }, 0).inventory[0]!.affixes[0]!
            .id,
        );
      }
      expect(seen.has('maxHp')).toBe(true);
      expect(seen.size).toBe(AFFIX_IDS.length);
    });

    it('draws as drawAffixes does, with the item’s favoured weights', () => {
      const start = rich([sword(['maxHp', 'defence'])], 1e6, 9);
      const s = rerollAffix(start, { bag: 0 }, 0);
      const rng = rngFrom(structuredClone(start.rng));
      const [want] = drawAffixes(rng, 1, favouredAffixes(start.inventory[0]!), ['defence']);
      expect(s.inventory[0]!.affixes[0]).toEqual(want);
      // Over many rerolls the sword family's three favoured affixes come up at 3 / 15 each.
      const n = 6000;
      let favoured = 0;
      let state = start;
      for (let i = 0; i < n; i++) {
        state = rerollAffix(state, { bag: 0 }, 0);
        if (PATH_FAVOURS.sword.includes(state.inventory[0]!.affixes[0]!.id)) favoured += 1;
      }
      // Pool of 8 (defence kept out): three weigh 3, five weigh 1, so 9 / 14.
      expect(favoured / n).toBeCloseTo(9 / 14, 1);
    });

    it('keeps the Immortal unique and a disc’s array type', () => {
      const immortal: Item = {
        slot: 'weapon',
        name: 'Phoenix Flame Flying Sword',
        level: 2,
        grade: 'immortal',
        baseRoll: 0.5,
        affixes: (['critChance', 'critDamage', 'attackSpeed', 'lifesteal', 'maxHp'] as const).map(
          (id) => ({ id, roll: 0.5 }),
        ),
        unique: 'overtime',
      };
      for (let i = 0; i < 5; i++) {
        const after = rerollAffix(rich([immortal], 1e6, i), { bag: 0 }, i).inventory[0]!;
        expect(after.unique).toBe('overtime');
        expect(new Set(after.affixes.map((a) => a.id)).size).toBe(5);
        expect(after.affixes.filter((_, j) => j !== i)).toEqual(
          immortal.affixes.filter((_, j) => j !== i),
        );
      }
      const disc: Item = {
        slot: 'attachment',
        name: 'Azure Bagua Disc',
        level: 2,
        grade: 'spirit',
        baseRoll: 0.5,
        affixes: [{ id: 'maxHp', roll: 0.5 }],
        array: 'killing',
      };
      const worn = equip(rich([disc]), 0);
      const after = rerollAffix(worn, { slot: 'attachment' }, 0).cultivator.equipment.attachment!;
      expect(after.array).toBe('killing');
      expect(after.baseRoll).toBe(0.5);
    });

    it('is the same for the same seed and leaves the input untouched', () => {
      const start = rich([sword(['maxHp', 'defence'])]);
      const copy = structuredClone(start);
      const a = rerollAffix(start, { bag: 0 }, 1);
      expect(start).toEqual(copy);
      expect(rerollAffix(start, { bag: 0 }, 1)).toEqual(a);
      expect(a.rng.s).not.toBe(start.rng.s);
    });

    it('rejects too little Essence, an item with no affixes, a bad affix or place', () => {
      const it = sword(['maxHp', 'defence']);
      const cost = rerollCost(it);
      expect(() => rerollAffix(rich([it], cost - 1), { bag: 0 }, 0)).toThrow(RangeError);
      expect(rerollAffix(rich([it], cost), { bag: 0 }, 0).essence).toBe(0);
      expect(() => rerollAffix(rich([item('mortal')]), { bag: 0 }, 0)).toThrow(RangeError);
      const s = rich([it]);
      for (const i of [-1, 2, 0.5, Number.NaN]) {
        expect(() => rerollAffix(s, { bag: 0 }, i)).toThrow(RangeError);
      }
      expect(() => rerollAffix(s, { bag: 1 }, 0)).toThrow(RangeError);
      expect(() => rerollAffix(s, { slot: 'weapon' }, 0)).toThrow(RangeError);
    });
  });
});
