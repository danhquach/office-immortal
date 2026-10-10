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
    burstMultiplier: 4,
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

export function derive(c: Pick<Cultivator, 'path' | 'level' | 'stats' | 'equipment'>): Derived {
  const { body, agility } = c.stats;
  const path = PATHS[c.path];
  const b = equipmentBonuses(c.equipment);
  const realm = REALM_BONUS * realmOf(c.level);
  return {
    maxHp: Math.round((40 + 12 * body + b.maxHp) * (1 + b.maxHpPct + realm)),
    defence: body + b.defence,
    damage: (4 + 1.5 * c.stats[path.primary] + b.damage) * (1 + b.damagePct + realm),
    attackInterval: Math.max(MIN_ATTACK_INTERVAL, 1 / (1 + 0.008 * agility + b.attackSpeed)),
    critChance: Math.min(MAX_CRIT_CHANCE, 0.05 + 0.002 * agility + b.critChance),
    critMultiplier: path.critMultiplier + b.critDamage,
    lifesteal: Math.min(MAX_LIFESTEAL, path.lifesteal + b.lifesteal),
    qiRegen: b.qiRegen,
    stoneFind: b.stoneFind,
    treasureFind: b.treasureFind,
  };
}

// Realms (docs/design.md §4): every LEVELS_PER_REALM levels is a cap that only
// a Tribulation win breaks through. Up to Immortal Ascension; Immortal is endless.

export interface Realm {
  readonly name: string;
  /** The office cover; Immortal has none. */
  readonly title: string | null;
}

export const REALMS: readonly Realm[] = [
  { name: 'Qi Condensation', title: 'Intern' },
  { name: 'Foundation Establishment', title: 'Associate' },
  { name: 'Golden Core', title: 'Manager' },
  { name: 'Nascent Soul', title: 'Director' },
  { name: 'Spirit Severing', title: 'VP' },
  { name: 'Immortal Ascension', title: 'CEO' },
  { name: 'Immortal', title: null },
];

export const LEVELS_PER_REALM = 10;
/** Max HP and damage each realm reached adds, as a share. */
export const REALM_BONUS = 0.1;
/** The last capped level; past it, Immortal levels without end. */
export const LAST_CAP = LEVELS_PER_REALM * (REALMS.length - 1);

/** Index into REALMS for a level: 1–10 is 0, 11–20 is 1, …, 61+ is Immortal. */
export function realmOf(level: number): number {
  return Math.min(REALMS.length - 1, Math.floor((level - 1) / LEVELS_PER_REALM));
}

/** True for 10, 20, … 60: the level can't be passed without a Tribulation win. */
export function isRealmCap(level: number): boolean {
  return level % LEVELS_PER_REALM === 0 && level <= LAST_CAP;
}

/** At a cap with the XP for the next level held: the Tribulation is due. */
export function readyForTribulation(c: Pick<Cultivator, 'level' | 'xp'>): boolean {
  return isRealmCap(c.level) && c.xp >= xpToNext(c.level);
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
 * Adds XP and applies every level-up it pays for, stopping at a realm cap:
 * XP past the cap is held until breakThrough(). Each level's stat points go
 * to the Path's primary stat; any max HP gained is also healed.
 */
export function gainXp(c: Cultivator, xp: number): void {
  // Held XP never passes what a save can store as a whole number.
  c.xp = Math.min(Number.MAX_SAFE_INTEGER, c.xp + xp);
  while (!isRealmCap(c.level) && c.xp >= xpToNext(c.level)) levelUp(c);
}

/**
 * The Tribulation was won: passes the cap into the next realm (whose bonus
 * comes with the level), then spends the rest of the held XP.
 */
export function breakThrough(c: Cultivator): void {
  if (!readyForTribulation(c)) throw new RangeError(`breakThrough: not ready at ${c.level}`);
  levelUp(c);
  gainXp(c, 0);
}

function levelUp(c: Cultivator): void {
  const before = derive(c).maxHp;
  c.xp -= xpToNext(c.level);
  c.level += 1;
  c.stats[PATHS[c.path].primary] += STAT_POINTS_PER_LEVEL;
  c.hp += derive(c).maxHp - before;
}
