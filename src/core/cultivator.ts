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
    lifesteal: 0.05,
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
    burstMultiplier: 5,
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
  const stats = effectiveStats(c);
  const { body, agility } = stats;
  const path = PATHS[c.path];
  const b = equipmentBonuses(c.equipment);
  const realm = REALM_BONUS * realmOf(c.level);
  return {
    maxHp: Math.round((40 + 12 * body + b.maxHp) * (1 + b.maxHpPct + realm)),
    defence: body + b.defence,
    damage: (4 + 1.5 * stats[path.primary] + b.damage) * (1 + b.damagePct + realm),
    attackInterval: Math.max(MIN_ATTACK_INTERVAL, 1 / (1 + 0.008 * agility + b.attackSpeed)),
    critChance: Math.min(MAX_CRIT_CHANCE, 0.05 + 0.002 * agility + b.critChance),
    critMultiplier: path.critMultiplier + b.critDamage,
    lifesteal: Math.min(MAX_LIFESTEAL, path.lifesteal + b.lifesteal),
    qiRegen: b.qiRegen,
    stoneFind: b.stoneFind,
    treasureFind: b.treasureFind,
  };
}

// Realms (docs/design.md §4): each realm ends at a cap that only a Tribulation
// win breaks through. Up to Tribulation Transcendence; Immortal Ascension is
// endless.

export interface Realm {
  readonly name: string;
  /** The office cover; Immortal Ascension has none. */
  readonly title: string | null;
}

export const REALMS: readonly Realm[] = [
  { name: 'Qi Condensation', title: 'Intern' },
  { name: 'Foundation Establishment', title: 'Associate' },
  { name: 'Golden Core', title: 'Team Lead' },
  { name: 'Nascent Soul', title: 'Manager' },
  { name: 'Spirit Transformation', title: 'Senior Manager' },
  { name: 'Void Refinement', title: 'Director' },
  { name: 'Body Integration', title: 'VP' },
  { name: 'Mahayana', title: 'CEO' },
  { name: 'Tribulation Transcendence', title: 'Chairman' },
  { name: 'Immortal Ascension', title: null },
];

/** The last level of each realm below Immortal Ascension: 10, 20, 40, 60, 80, 110, 140, 170, 210. */
export const REALM_CAPS: readonly number[] = [10, 20, 40, 60, 80, 110, 140, 170, 210];
/** Max HP and damage each realm reached adds, as a share. */
export const REALM_BONUS = 0.1;
/**
 * Breaking into a realm raises the Path's primary stat by a share that grows
 * evenly from REALM_PRIMARY_STEP (Foundation Establishment) to
 * REALM_PRIMARY_LAST_STEP (Immortal Ascension), so each harder realm gives a
 * bigger boost: +1%, +1.625%, … +6%, 31.5% in all.
 */
export const REALM_PRIMARY_STEP = 0.01;
export const REALM_PRIMARY_LAST_STEP = 0.06;
const REALM_PRIMARY_STEP_GROWTH =
  (REALM_PRIMARY_LAST_STEP - REALM_PRIMARY_STEP) / (REALMS.length - 2);
/** The last capped level; past it, Immortal Ascension levels without end. */
export const LAST_CAP = REALM_CAPS[REALM_CAPS.length - 1] as number;

/** Index into REALMS for a level: 1–10 is 0, 11–20 is 1, …, 211+ is Immortal Ascension. */
export function realmOf(level: number): number {
  const i = REALM_CAPS.findIndex((cap) => level <= cap);
  return i < 0 ? REALMS.length - 1 : i;
}

/** The levels realm `i` spans; `to` is null for endless Immortal Ascension. */
export function realmLevels(i: number): { from: number; to: number | null } {
  return { from: (REALM_CAPS[i - 1] ?? 0) + 1, to: REALM_CAPS[i] ?? null };
}

/** True for 10, 20, … 210: the level can't be passed without a Tribulation win. */
export function isRealmCap(level: number): boolean {
  return REALM_CAPS.includes(level);
}

/** The share realm `r` (an index into REALMS) and those below it add to the primary stat. */
export function realmPrimaryShare(r: number): number {
  return REALM_PRIMARY_STEP * r + (REALM_PRIMARY_STEP_GROWTH * r * (r - 1)) / 2;
}

/** The share the realms reached at `level` add to the primary stat. */
export function realmPrimaryBonus(level: number): number {
  return realmPrimaryShare(realmOf(level));
}

/** Stats as they fight: the primary one raised by the realm bonus (not rounded, so +1% of a small stat still counts). */
export function effectiveStats(c: Pick<Cultivator, 'path' | 'level' | 'stats'>): Stats {
  const primary = PATHS[c.path].primary;
  const stats = { ...c.stats };
  stats[primary] *= 1 + realmPrimaryBonus(c.level);
  return stats;
}

/** At a cap with the XP for the next level held: the Tribulation is due. */
export function readyForTribulation(c: Pick<Cultivator, 'level' | 'xp'>): boolean {
  return isRealmCap(c.level) && c.xp >= xpToNext(c.level);
}

/** How much dearer each level is than the one before: the same growth as a kill's XP per floor. */
export const LEVEL_XP_GROWTH = 1.15;

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return Math.round(50 * LEVEL_XP_GROWTH ** (level - 1));
}

/** A level 1 cultivator; `bonusPoints` (from Dao Insight passives) go to the primary stat. */
export function newCultivator(path: PathId, bonusPoints = 0): Cultivator {
  const stats: Stats = { body: BASE_STAT, agility: BASE_STAT, spirit: BASE_STAT };
  stats[PATHS[path].primary] += STARTING_PRIMARY_BONUS + bonusPoints;
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
