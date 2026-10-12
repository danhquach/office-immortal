// Currencies, selling, salvage, the auto filter, crafting and what Spirit
// Stones buy (docs/design.md §7, §8). Every number here is a starting point
// for balancing.
//
// Spirit Stones come from kills and selling; Spirit Essence comes from salvage
// and pays for crafting. Only bag items can be sold or salvaged: those actions
// take a bag index, so equipped items are never touched. Crafting (refine a
// base roll, reroll one affix) works on bag and equipped items alike, and
// draws its rolls from the game's seeded stream, state.rng.

import {
  BASE_STAT,
  derive,
  PATHS,
  type Cultivator,
  type PathId,
  type StatId,
} from './cultivator.ts';
import type { EnemyKind } from './floors.ts';
import {
  drawAffixes,
  EQUIP_SLOTS,
  favouredAffixes,
  GRADES,
  MAX_REFINES,
  SLOTS,
  type EquipSlotId,
  type GradeId,
  type Item,
  type SlotId,
} from './loot.ts';
import { int, rngFrom, type Rng } from './rng.ts';
import type { GameState } from './sim.ts';

/** Bag cells at the start of a run. */
export const INVENTORY_SIZE = 40;
/** Cells one bag upgrade adds: one row of the grid. */
export const BAG_ROW = 8;
export const MAX_BAG_SIZE = INVENTORY_SIZE + 5 * BAG_ROW;

/** Spirit Stones per kill on floor 1; each floor adds 10% of it. Spirit stone find raises it. */
export const KILL_STONES: Readonly<Record<EnemyKind, number>> = {
  demon: 1,
  elite: 3,
  boss: 10,
  tribulation: 25,
};
/** Spirit Stones for selling an item, per item level. */
export const SELL_VALUE: Readonly<Record<GradeId, number>> = {
  mortal: 2,
  spirit: 5,
  earth: 15,
  heaven: 40,
  immortal: 150,
};
/** Spirit Essence for salvaging an item, per item level. */
export const ESSENCE_VALUE: Readonly<Record<GradeId, number>> = {
  mortal: 1,
  spirit: 2,
  earth: 5,
  heaven: 12,
  immortal: 40,
};
/** Spirit Stone costs, per cultivator level. */
export const PATH_CHANGE_COST = 500;
export const STAT_RESET_COST = 200;
/** The first bag upgrade's cost; each one after costs three times the last. */
export const BAG_COST = 500;
/** Spirit Essence costs, as multiples of what salvaging the item pays (essenceValue). */
export const REFINE_COST_MULT = 2;
export const REROLL_COST_MULT = 3;
/**
 * How likely each refine gain (+1 to +10 points of base roll) is: LOW at a base
 * roll of 0%, HIGH at 100%, blended in between (refineWeights). Each sums to
 * 100. Small gains grow likelier as the roll climbs.
 */
export const REFINE_WEIGHTS_LOW: readonly number[] = [25, 20, 15, 10, 8, 7, 5, 4, 3, 3];
export const REFINE_WEIGHTS_HIGH: readonly number[] = [50, 25, 12, 5, 3, 2, 1, 1, 1, 0];
/** The total of refineWeights(p) for every p: a refine picks int(rng, 1, REFINE_WEIGHT_TOTAL). */
export const REFINE_WEIGHT_TOTAL = 10_000;

export const GRADE_IDS = Object.keys(GRADES) as GradeId[];
export const SLOT_IDS = Object.keys(SLOTS) as SlotId[];
const STAT_IDS: readonly StatId[] = ['body', 'agility', 'spirit'];

/** What happens to drops the filter does not keep. */
export type FilterAction = 'sell' | 'salvage';

/** Keeps drops of `minGrade` or better whose type is in `slots`; the rest get `action`. */
export interface LootFilter {
  minGrade: GradeId;
  /** Item types kept, in SLOTS order. */
  slots: SlotId[];
  action: FilterAction;
}

/** Keeps every drop: the filter starts off. */
export function defaultFilter(): LootFilter {
  return { minGrade: 'mortal', slots: [...SLOT_IDS], action: 'sell' };
}

/** 0 for Mortal up to 4 for Immortal. */
export function gradeRank(grade: GradeId): number {
  return GRADE_IDS.indexOf(grade);
}

export function sellPrice(item: Item): number {
  return SELL_VALUE[item.grade] * item.level;
}

export function essenceValue(item: Item): number {
  return ESSENCE_VALUE[item.grade] * item.level;
}

export function killStones(kind: EnemyKind, floor: number, stoneFind: number): number {
  return Math.round(KILL_STONES[kind] * (1 + (floor - 1) / 10) * (1 + stoneFind));
}

export type Currency = 'stones' | 'essence';
const CURRENCY_NAMES: Readonly<Record<Currency, string>> = {
  stones: 'Spirit Stones',
  essence: 'Spirit Essence',
};

/** Adds to a currency, stopping at the largest whole number a save can hold. */
export function earn(s: GameState, currency: Currency, n: number): void {
  s[currency] = Math.min(Number.MAX_SAFE_INTEGER, s[currency] + n);
}

export function keeps(filter: LootFilter, item: Item): boolean {
  return gradeRank(item.grade) >= gradeRank(filter.minGrade) && filter.slots.includes(item.slot);
}

/**
 * Puts a fresh drop where it belongs: the bag if the filter keeps it and there
 * is room; otherwise sold or salvaged as the filter says. A full bag always
 * sells. Mutates `s`; the sim calls it on its own clone.
 */
export function pickUp(s: GameState, item: Item): void {
  const kept = keeps(s.filter, item);
  if (kept && s.inventory.length < s.bagSize) {
    s.inventory.push(item);
  } else if (kept || s.filter.action === 'sell') {
    earn(s, 'stones', sellPrice(item));
    s.dropsSold += 1;
  } else {
    earn(s, 'essence', essenceValue(item));
    s.dropsSalvaged += 1;
  }
}

function bagItem(state: GameState, index: number, what: string): Item {
  const item = Number.isInteger(index) ? state.inventory[index] : undefined;
  if (!item) throw new RangeError(`${what}: no item at ${index}`);
  return item;
}

/** Sells the bag item at `index` for Spirit Stones; `state` is left untouched. */
export function sell(state: GameState, index: number): GameState {
  const item = bagItem(state, index, 'sell');
  const s = structuredClone(state);
  s.inventory.splice(index, 1);
  earn(s, 'stones', sellPrice(item));
  return s;
}

/** Salvages the bag item at `index` into Spirit Essence; `state` is left untouched. */
export function salvage(state: GameState, index: number): GameState {
  const item = bagItem(state, index, 'salvage');
  const s = structuredClone(state);
  s.inventory.splice(index, 1);
  earn(s, 'essence', essenceValue(item));
  return s;
}

/** True when bulk selling below `grade` takes `item`: below it, and never refined (§7). */
function soldBelow(item: Item, grade: GradeId): boolean {
  return gradeRank(item.grade) < gradeRank(grade) && !item.refines;
}

/**
 * What selling every bag item below `grade` would do, for the confirmation.
 * Refined items (+1 or higher) are kept; `kept` counts those below `grade`.
 */
export function sellBelowPreview(
  state: GameState,
  grade: GradeId,
): { count: number; highest: GradeId | null; stones: number; kept: number } {
  const items = state.inventory.filter((i) => soldBelow(i, grade));
  const highest = items.reduce<GradeId | null>(
    (best, i) => (best === null || gradeRank(i.grade) > gradeRank(best) ? i.grade : best),
    null,
  );
  const below = state.inventory.filter((i) => gradeRank(i.grade) < gradeRank(grade)).length;
  return {
    count: items.length,
    highest,
    stones: items.reduce((n, i) => n + sellPrice(i), 0),
    kept: below - items.length,
  };
}

/** Sells every bag item below `grade` but the refined ones; `state` is left untouched. */
export function sellBelow(state: GameState, grade: GradeId): GameState {
  if (!GRADE_IDS.includes(grade)) throw new RangeError(`sellBelow: no grade ${grade}`);
  const s = structuredClone(state);
  earn(s, 'stones', sellBelowPreview(state, grade).stones);
  s.inventory = s.inventory.filter((i) => !soldBelow(i, grade));
  return s;
}

const FILTER_ACTIONS: readonly FilterAction[] = ['sell', 'salvage'];

/**
 * Replaces the filter, keeping its slots in SLOTS order without repeats.
 * Anything the save would reject is refused here, so it never gets saved.
 */
export function setFilter(state: GameState, filter: LootFilter): GameState {
  if (!GRADE_IDS.includes(filter.minGrade)) throw new RangeError('setFilter: bad grade');
  if (!FILTER_ACTIONS.includes(filter.action)) throw new RangeError('setFilter: bad action');
  if (!filter.slots.every((id) => SLOT_IDS.includes(id)))
    throw new RangeError('setFilter: bad slot');
  const s = structuredClone(state);
  s.filter = {
    minGrade: filter.minGrade,
    slots: SLOT_IDS.filter((id) => filter.slots.includes(id)),
    action: filter.action,
  };
  return s;
}

/** The next bag upgrade's cost, or null when the bag is as big as it gets. */
export function bagCost(state: GameState): number | null {
  if (state.bagSize >= MAX_BAG_SIZE) return null;
  return BAG_COST * 3 ** ((state.bagSize - INVENTORY_SIZE) / BAG_ROW);
}

export function pathChangeCost(c: Cultivator): number {
  return PATH_CHANGE_COST * c.level;
}

export function statResetCost(c: Cultivator): number {
  return STAT_RESET_COST * c.level;
}

/** Takes `cost` of `currency` from a clone of `state`, or throws when it can't be paid. */
function pay(state: GameState, currency: Currency, cost: number, what: string): GameState {
  if (state[currency] < cost) {
    throw new RangeError(`${what}: needs ${cost} ${CURRENCY_NAMES[currency]}`);
  }
  const s = structuredClone(state);
  s[currency] -= cost;
  return s;
}

export function buyBagSpace(state: GameState): GameState {
  const cost = bagCost(state);
  if (cost === null) throw new RangeError('buyBagSpace: the bag is full size');
  const s = pay(state, 'stones', cost, 'buyBagSpace');
  s.bagSize += BAG_ROW;
  return s;
}

/** Every stat point above the base, with nothing spent. */
function unassign(c: Cultivator): void {
  const total = STAT_IDS.reduce((n, id) => n + c.stats[id], 0) + c.unspent;
  for (const id of STAT_IDS) c.stats[id] = BASE_STAT;
  c.unspent = total - STAT_IDS.length * BASE_STAT;
}

/** Max HP may have dropped; never sit above it. */
function clampHp(c: Cultivator): void {
  c.hp = Math.min(c.hp, derive(c).maxHp);
}

/** Switches Path; every stat point is re-spent on the new primary stat. */
export function changePath(state: GameState, path: PathId): GameState {
  if (!Object.hasOwn(PATHS, path)) throw new RangeError(`changePath: no Path ${path}`);
  if (path === state.cultivator.path) throw new RangeError('changePath: already on that Path');
  const s = pay(state, 'stones', pathChangeCost(state.cultivator), 'changePath');
  const c = s.cultivator;
  c.path = path;
  unassign(c);
  c.stats[PATHS[path].primary] += c.unspent;
  c.unspent = 0;
  clampHp(c);
  return s;
}

/** True when a reset would change something: some point is spent above the base. */
export function canResetStats(c: Cultivator): boolean {
  return STAT_IDS.some((id) => c.stats[id] > BASE_STAT);
}

/** Takes back every stat point above the base, to be spent with spendPoints(). */
export function resetStats(state: GameState): GameState {
  if (!canResetStats(state.cultivator)) throw new RangeError('resetStats: nothing to reset');
  const s = pay(state, 'stones', statResetCost(state.cultivator), 'resetStats');
  unassign(s.cultivator);
  clampHp(s.cultivator);
  return s;
}

/** Spends `n` unspent stat points on `stat`. */
export function spendPoints(state: GameState, stat: StatId, n: number): GameState {
  if (!STAT_IDS.includes(stat)) throw new RangeError(`spendPoints: no stat ${stat}`);
  if (!Number.isInteger(n) || n < 1 || n > state.cultivator.unspent) {
    throw new RangeError(`spendPoints: can't spend ${n}`);
  }
  const s = structuredClone(state);
  const c = s.cultivator;
  const before = derive(c).maxHp;
  c.stats[stat] += n;
  c.unspent -= n;
  // Max HP gained from Body is healed, as on a level-up.
  c.hp += Math.max(0, derive(c).maxHp - before);
  return s;
}

// Crafting (docs/design.md §7): Spirit Essence spent on one item, in the bag
// or equipped. The Immortal unique and a disc's array type are never touched.

/** Where an item to craft is: a bag index or an equipped position. */
export type ItemAt = { bag: number } | { slot: EquipSlotId };

/** The item at `at`, or throws for a place with none. */
function itemAt(state: GameState, at: ItemAt, what: string): Item {
  let item: Item | undefined;
  if ('bag' in at) {
    item = Number.isInteger(at.bag) ? state.inventory[at.bag] : undefined;
  } else if (Object.hasOwn(EQUIP_SLOTS, at.slot)) {
    item = state.cultivator.equipment[at.slot];
  }
  if (!item) throw new RangeError(`${what}: no item at ${JSON.stringify(at)}`);
  return item;
}

export function refineCost(item: Item): number {
  return REFINE_COST_MULT * essenceValue(item);
}

export function rerollCost(item: Item): number {
  return REROLL_COST_MULT * essenceValue(item);
}

/** A base roll as whole points, 0 to 100. Rolls are whole percents; this undoes float drift. */
export function rollPoints(roll: number): number {
  return Math.round(roll * 100);
}

/**
 * The weight of each refine gain, +1 to +10 points, at a base roll of `p`
 * points (0 to 100): LOW × (100 − p) + HIGH × p, whole numbers summing to
 * REFINE_WEIGHT_TOTAL.
 */
export function refineWeights(p: number): number[] {
  if (!Number.isInteger(p) || p < 0 || p > 100) throw new RangeError(`refineWeights: bad p ${p}`);
  return REFINE_WEIGHTS_LOW.map((lo, i) => lo * (100 - p) + (REFINE_WEIGHTS_HIGH[i] ?? 0) * p);
}

/** A refine's gain in points (+1 to +10), picked by refineWeights(p). */
export function refineGain(rng: Rng, p: number): number {
  let n = int(rng, 1, REFINE_WEIGHT_TOTAL);
  for (const [i, w] of refineWeights(p).entries()) {
    n -= w;
    if (n <= 0) return i + 1;
  }
  throw new Error('refineGain: weights do not cover the roll');
}

/**
 * The base rolls a refine of `item` can land on, as [lowest, highest] in
 * points; null once it is fully refined (100%).
 */
export function refineReach(item: Item): [number, number] | null {
  const p = rollPoints(item.baseRoll);
  return p >= 100 ? null : [p + 1, Math.min(100, p + REFINE_WEIGHTS_LOW.length)];
}

/**
 * Refines the item at `at`: its base roll (a disc's array strength) goes up by
 * refineGain() points, capped at 100%, and its refine level by one, for
 * refineCost() Spirit Essence. `state` is left untouched.
 */
export function refine(state: GameState, at: ItemAt): GameState {
  const item = itemAt(state, at, 'refine');
  const p = rollPoints(item.baseRoll);
  if (p >= 100) throw new RangeError('refine: fully refined');
  const s = pay(state, 'essence', refineCost(item), 'refine');
  const mine = itemAt(s, at, 'refine');
  mine.baseRoll = Math.min(100, p + refineGain(rngFrom(s.rng), p)) / 100;
  mine.refines = Math.min(MAX_REFINES, (mine.refines ?? 0) + 1);
  // A refine only raises a stat, but HP is kept within the gear's max all the
  // same: the save refuses a cultivator above it.
  clampHp(s.cultivator);
  return s;
}

/**
 * Rerolls affix `affixIndex` of the item at `at` for rerollCost() Spirit
 * Essence: a new affix and roll, drawn with the item's favoured weights as on
 * a drop, never one of its other affixes (it may be the same one again). The
 * rest of the item is kept. `state` is left untouched.
 */
export function rerollAffix(state: GameState, at: ItemAt, affixIndex: number): GameState {
  const item = itemAt(state, at, 'rerollAffix');
  if (item.affixes.length === 0) throw new RangeError('rerollAffix: no affixes');
  if (!Number.isInteger(affixIndex) || !item.affixes[affixIndex]) {
    throw new RangeError(`rerollAffix: no affix ${affixIndex}`);
  }
  const s = pay(state, 'essence', rerollCost(item), 'rerollAffix');
  const mine = itemAt(s, at, 'rerollAffix');
  const others = mine.affixes.filter((_, i) => i !== affixIndex).map((a) => a.id);
  const [fresh] = drawAffixes(rngFrom(s.rng), 1, favouredAffixes(mine), others);
  if (!fresh) throw new Error('rerollAffix: nothing to draw');
  mine.affixes[affixIndex] = fresh;
  // A worn item can lose Max HP; never sit above the new max (as equip does).
  clampHp(s.cultivator);
  return s;
}
