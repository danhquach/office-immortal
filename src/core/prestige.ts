// Early Retirement and Dao Insight (docs/design.md §9). Retiring starts a new
// run and pays Dao Insight for the highest floor reached; Insight buys
// passives that last across every run. Every number here is a starting point
// for balancing.

import { derive, PATHS } from './cultivator.ts';
import { INVENTORY_SIZE } from './economy.ts';
import type { GameState } from './sim.ts';

export type PassiveId = 'xp' | 'treasure' | 'offline' | 'points';

export interface Passive {
  readonly name: string;
  /** What one rank adds, in words. */
  readonly perRankText: string;
  /** The first rank's cost in Dao Insight; each rank after costs twice the last. */
  readonly baseCost: number;
  readonly maxRank: number;
}

export const PASSIVES: Readonly<Record<PassiveId, Passive>> = {
  xp: { name: 'Seniority', perRankText: '+10% XP', baseCost: 2, maxRank: 20 },
  treasure: {
    name: 'Expense Account',
    perRankText: '+5% treasure find',
    baseCost: 2,
    maxRank: 20,
  },
  offline: {
    name: 'Flexible Hours',
    perRankText: '+1 h Overtime Cultivation cap',
    baseCost: 3,
    maxRank: 8,
  },
  points: { name: 'Head Start', perRankText: '+2 stat points', baseCost: 3, maxRank: 20 },
};

export const PASSIVE_IDS = Object.keys(PASSIVES) as PassiveId[];

/** Ranks bought in each passive. */
export type Passives = Record<PassiveId, number>;

export const XP_PER_RANK = 0.1;
export const TREASURE_PER_RANK = 0.05;
export const OFFLINE_SECONDS_PER_RANK = 60 * 60;
export const POINTS_PER_RANK = 2;
/** Retiring below this floor pays nothing, so it isn't offered. */
export const RETIRE_MIN_FLOOR = 10;
/** Insight = highest floor² / this, rounded down. */
export const INSIGHT_DIVISOR = 50;

export function noPassives(): Passives {
  return { xp: 0, treasure: 0, offline: 0, points: 0 };
}

/** Dao Insight paid for retiring with `highestFloor` reached: 0 below RETIRE_MIN_FLOOR. */
export function insightFor(highestFloor: number): number {
  if (highestFloor < RETIRE_MIN_FLOOR) return 0;
  return Math.floor(highestFloor ** 2 / INSIGHT_DIVISOR);
}

export function canRetire(state: GameState): boolean {
  return insightFor(state.highestFloor) > 0;
}

/** Multiplies the XP of every kill. */
export function xpMultiplier(p: Passives): number {
  return 1 + XP_PER_RANK * p.xp;
}

/** Added to the treasure find from gear. */
export function passiveTreasureFind(p: Passives): number {
  return TREASURE_PER_RANK * p.treasure;
}

/** Stat points every run starts with on top of the base. */
export function bonusPoints(p: Passives): number {
  return POINTS_PER_RANK * p.points;
}

/** The next rank's cost, or null at the max rank. */
export function passiveCost(p: Passives, id: PassiveId): number | null {
  const { baseCost, maxRank } = PASSIVES[id];
  return p[id] >= maxRank ? null : baseCost * 2 ** p[id];
}

/**
 * Buys one rank of `id` with Dao Insight; `state` is left untouched. Passives
 * apply at once: a Head Start rank also adds its stat points to this run, to
 * the Path's primary stat as a level-up does.
 */
export function buyPassive(state: GameState, id: PassiveId): GameState {
  if (!PASSIVE_IDS.includes(id)) throw new RangeError(`buyPassive: no passive ${id}`);
  const cost = passiveCost(state.passives, id);
  if (cost === null) throw new RangeError(`buyPassive: ${id} is at its max rank`);
  if (state.insight < cost) throw new RangeError(`buyPassive: needs ${cost} Dao Insight`);
  const s = structuredClone(state);
  s.insight -= cost;
  s.passives[id] += 1;
  if (id === 'points') {
    const c = s.cultivator;
    const before = derive(c).maxHp;
    c.stats[PATHS[c.path].primary] += POINTS_PER_RANK;
    c.hp += Math.max(0, derive(c).maxHp - before);
  }
  return s;
}

/** What retiring now keeps and loses, for the confirmation. */
export interface RetirePreview {
  /** Dao Insight retiring pays. */
  insight: number;
  /** Dao Insight held after retiring. */
  insightAfter: number;
  highestFloor: number;
  level: number;
  /** Items in the bag and equipped. */
  items: number;
  stones: number;
  essence: number;
  /** Bag cells bought, lost with the run. */
  bagCells: number;
}

export function retirePreview(state: GameState): RetirePreview {
  const insight = insightFor(state.highestFloor);
  return {
    insight,
    insightAfter: Math.min(Number.MAX_SAFE_INTEGER, state.insight + insight),
    highestFloor: state.highestFloor,
    level: state.cultivator.level,
    items: state.inventory.length + Object.keys(state.cultivator.equipment).length,
    stones: state.stones,
    essence: state.essence,
    bagCells: state.bagSize - INVENTORY_SIZE,
  };
}
