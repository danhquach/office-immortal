// Currencies, selling, salvage, the auto filter and what Spirit Stones buy
// (docs/design.md §7, §8). Every number here is a starting point for balancing.
//
// Spirit Stones come from kills and selling; Spirit Essence comes from salvage
// and is kept for crafting (later work). Only bag items can be sold or
// salvaged: every action here takes a bag index, so equipped items are never
// touched.

import {
  BASE_STAT,
  derive,
  PATHS,
  type Cultivator,
  type PathId,
  type StatId,
} from './cultivator.ts';
import type { EnemyKind } from './floors.ts';
import { GRADES, SLOTS, type GradeId, type Item, type SlotId } from './loot.ts';
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

/** Adds to a currency, stopping at the largest whole number a save can hold. */
export function earn(s: GameState, currency: 'stones' | 'essence', n: number): void {
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

/** What selling every bag item below `grade` would do, for the confirmation. */
export function sellBelowPreview(
  state: GameState,
  grade: GradeId,
): { count: number; highest: GradeId | null; stones: number } {
  const items = state.inventory.filter((i) => gradeRank(i.grade) < gradeRank(grade));
  const highest = items.reduce<GradeId | null>(
    (best, i) => (best === null || gradeRank(i.grade) > gradeRank(best) ? i.grade : best),
    null,
  );
  return { count: items.length, highest, stones: items.reduce((n, i) => n + sellPrice(i), 0) };
}

/** Sells every bag item below `grade`; `state` is left untouched. */
export function sellBelow(state: GameState, grade: GradeId): GameState {
  if (!GRADE_IDS.includes(grade)) throw new RangeError(`sellBelow: no grade ${grade}`);
  const s = structuredClone(state);
  earn(s, 'stones', sellBelowPreview(state, grade).stones);
  s.inventory = s.inventory.filter((i) => gradeRank(i.grade) >= gradeRank(grade));
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

/** Takes `cost` Spirit Stones from a clone of `state`, or throws when they can't be paid. */
function pay(state: GameState, cost: number, what: string): GameState {
  if (state.stones < cost) throw new RangeError(`${what}: needs ${cost} Spirit Stones`);
  const s = structuredClone(state);
  s.stones -= cost;
  return s;
}

export function buyBagSpace(state: GameState): GameState {
  const cost = bagCost(state);
  if (cost === null) throw new RangeError('buyBagSpace: the bag is full size');
  const s = pay(state, cost, 'buyBagSpace');
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
  const s = pay(state, pathChangeCost(state.cultivator), 'changePath');
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
  const s = pay(state, statResetCost(state.cultivator), 'resetStats');
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
