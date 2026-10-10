// The cultivator: Paths, stats and levelling (docs/design.md §3). Every number
// here is a starting point for balancing.

import { equipmentBonuses, type Equipment } from './loot.ts';

export type StatId = 'body' | 'agility' | 'spirit';
export type Stats = Record<StatId, number>;
export type PathId = 'sword' | 'body' | 'talisman';

export interface Path {
  readonly name: string;
  readonly primary: StatId;
  /** Damage multiplier on a crit. */
  readonly critMultiplier: number;
  /** Share of damage dealt that heals the cultivator. */
  readonly lifesteal: number;
  /** Every Nth attack is a burst for `burstMultiplier` damage; 0 means never. */
  readonly burstEvery: number;
  readonly burstMultiplier: number;
}

export const PATHS: Readonly<Record<PathId, Path>> = {
  sword: {
    name: 'Sword Cultivator',
    primary: 'agility',
    critMultiplier: 2,
    lifesteal: 0,
    burstEvery: 0,
    burstMultiplier: 1,
  },
  body: {
    name: 'Body Refiner',
    primary: 'body',
    critMultiplier: 1.5,
    lifesteal: 0.15,
    burstEvery: 0,
    burstMultiplier: 1,
  },
  talisman: {
    name: 'Talisman Master',
    primary: 'spirit',
    critMultiplier: 1.5,
    lifesteal: 0,
    burstEvery: 3,
    burstMultiplier: 2.5,
  },
};

export const BASE_STAT = 5;
export const STARTING_PRIMARY_BONUS = 3;
export const STAT_POINTS_PER_LEVEL = 3;
export const MAX_CRIT_CHANCE = 0.5;
/** Caps that keep stacked item bonuses from making the cultivator unkillable or the sim event-bound. */
export const MAX_LIFESTEAL = 0.5;
export const MIN_ATTACK_INTERVAL = 0.25;

export interface Cultivator {
  path: PathId;
  level: number;
  /** XP towards the next level. */
  xp: number;
  stats: Stats;
  /** Stat points taken back by a reset and not yet spent. */
  unspent: number;
  equipment: Equipment;
  hp: number;
  /** Sim time of the next attack, in seconds. */
  nextAttackAt: number;
  /** Attacks made on the current floor; drives the Talisman burst. */
  attackCount: number;
}

/** Combat numbers worked out from stats; never stored, so they can't drift. */
export interface Derived {
  maxHp: number;
  defence: number;
  damage: number;
  /** Seconds between attacks. */
  attackInterval: number;
  critChance: number;
  /** Damage multiplier on a crit. */
  critMultiplier: number;
  /** Share of damage dealt that heals the cultivator. */
  lifesteal: number;
  // Carried for the systems that will spend them (qi, Spirit Stones); combat ignores them.
  qiRegen: number;
  stoneFind: number;
  /** Raises the chance that a kill drops an item. */
  treasureFind: number;
}

export function derive(c: Pick<Cultivator, 'path' | 'stats' | 'equipment'>): Derived {
  const { body, agility } = c.stats;
  const path = PATHS[c.path];
  const b = equipmentBonuses(c.equipment);
  return {
    maxHp: Math.round((40 + 12 * body + b.maxHp) * (1 + b.maxHpPct)),
    defence: body + b.defence,
    damage: (4 + 1.5 * c.stats[path.primary] + b.damage) * (1 + b.damagePct),
    attackInterval: Math.max(MIN_ATTACK_INTERVAL, 1 / (1 + 0.02 * agility + b.attackSpeed)),
    critChance: Math.min(MAX_CRIT_CHANCE, 0.05 + 0.005 * agility + b.critChance),
    critMultiplier: path.critMultiplier + b.critDamage,
    lifesteal: Math.min(MAX_LIFESTEAL, path.lifesteal + b.lifesteal),
    qiRegen: b.qiRegen,
    stoneFind: b.stoneFind,
    treasureFind: b.treasureFind,
  };
}

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return Math.round(50 * 1.2 ** (level - 1));
}

export function newCultivator(path: PathId): Cultivator {
  const stats: Stats = { body: BASE_STAT, agility: BASE_STAT, spirit: BASE_STAT };
  stats[PATHS[path].primary] += STARTING_PRIMARY_BONUS;
  const c: Cultivator = {
    path,
    level: 1,
    xp: 0,
    stats,
    unspent: 0,
    equipment: {},
    hp: 0,
    nextAttackAt: 0,
    attackCount: 0,
  };
  c.hp = derive(c).maxHp;
  return c;
}

/**
 * Adds XP and applies every level-up it pays for. Each level's stat points go
 * to the Path's primary stat; any max HP gained is also healed.
 */
export function gainXp(c: Cultivator, xp: number): void {
  c.xp += xp;
  for (let need = xpToNext(c.level); c.xp >= need; need = xpToNext(c.level)) {
    const before = derive(c).maxHp;
    c.xp -= need;
    c.level += 1;
    c.stats[PATHS[c.path].primary] += STAT_POINTS_PER_LEVEL;
    c.hp += derive(c).maxHp - before;
  }
}
