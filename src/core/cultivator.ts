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
  /** Multiplies the Path's damage (docs/design.md §3). */
  readonly damageMultiplier: number;
  /** Share of damage dealt that heals the cultivator. */
  readonly lifesteal: number;
  /** Every Nth attack is a burst for `burstMultiplier` damage; 0 means never. */
  readonly burstEvery: number;
  readonly burstMultiplier: number;
  /** The share of MAX_QI_PER_SPIRIT and QI_PER_SPIRIT each Spirit point gives. */
  readonly qiFromSpirit: number;
}

export const PATHS: Readonly<Record<PathId, Path>> = {
  sword: {
    name: 'Sword Cultivator',
    primary: 'agility',
    critMultiplier: 2,
    damageMultiplier: 1,
    lifesteal: 0.05,
    burstEvery: 0,
    burstMultiplier: 1,
    qiFromSpirit: 0.5,
  },
  body: {
    name: 'Body Refiner',
    primary: 'body',
    critMultiplier: 1.5,
    damageMultiplier: 1.15,
    lifesteal: 0.15,
    burstEvery: 0,
    burstMultiplier: 1,
    qiFromSpirit: 0.5,
  },
  talisman: {
    name: 'Talisman Master',
    primary: 'spirit',
    critMultiplier: 1.5,
    damageMultiplier: 1,
    lifesteal: 0,
    burstEvery: 5,
    burstMultiplier: 5,
    qiFromSpirit: 1,
  },
};

export const PATH_IDS = Object.keys(PATHS) as PathId[];

export const BASE_STAT = 5;
export const STARTING_PRIMARY_BONUS = 3;
export const STAT_POINTS_PER_LEVEL = 3;
export const STAT_IDS: readonly StatId[] = ['body', 'agility', 'spirit'];
/** Caps that keep stacked item bonuses from making the cultivator unkillable or the sim event-bound. */
export const MAX_LIFESTEAL = 0.5;
export const MIN_ATTACK_INTERVAL = 0.25;

/** The cultivator's qi pool before Spirit (docs/design.md §5). */
export const BASE_MAX_QI = 100;
/** Max qi each Spirit point adds, scaled by the Path's qiFromSpirit. */
export const MAX_QI_PER_SPIRIT = 0.5;
/** Qi per second every cultivator regains, before gear and Spirit. */
export const QI_BASE_REGEN = 1;
/** Qi per second each Spirit point adds, scaled by the Path's qiFromSpirit. */
export const QI_PER_SPIRIT = 0.02;

// What a stat point does (docs/design.md §3). Every stat helps every Path; the
// Path's main stat also adds damage and its Mastery. The curves gain less as
// they grow but never stop.

/**
 * Path share: every stat effect is full for the Path whose main stat it is,
 * and this share for the other two Paths (docs/design.md §3).
 */
export const OFF_PATH_SHARE = 0.5;

/** How much of `stat`'s effects `path` gets: 1 for its main stat, OFF_PATH_SHARE otherwise. */
export function pathShare(path: PathId, stat: StatId): number {
  return PATHS[path].primary === stat ? 1 : OFF_PATH_SHARE;
}

/** Max HP, defence and HP a second per Body point, at full Path share. */
export const HP_PER_BODY = 10;
export const DEFENCE_PER_BODY = 0.5;
export const HP_REGEN_PER_BODY = 0.1;
/** Damage per point of the Path's main stat. */
export const DAMAGE_PER_MAIN = 1.5;

/**
 * A curve that gains less as `points` grow: `max · points / (points + half)`.
 * It reaches half of `max` at `half` points and never quite reaches `max`.
 */
export interface Curve {
  readonly max: number;
  readonly half: number;
}

export function curve(c: Curve, points: number): number {
  return points <= 0 ? 0 : (c.max * points) / (points + c.half);
}

/**
 * Where a curve's gains have slowed to half of what its first point gave:
 * half · (√2 − 1). The stat tip says "Gains slow above N" past it.
 */
export function slowsAt(c: Curve): number {
  return Math.round(c.half * (Math.SQRT2 - 1));
}

export const CRIT_BASE = 0.05;
/** Crit chance from Agility: about 23% at 100, 35% at 300 (with the base). */
export const CRIT_CURVE: Curve = { max: 0.45, half: 150 };
/** Dodge from Agility: about 5% at 100, 11% at 300. */
export const DODGE_CURVE: Curve = { max: 0.275, half: 450 };
/** Defence pierce from Spirit: about 17% at 100, 30% at 300. */
export const PIERCE_CURVE: Curve = { max: 0.485, half: 185 };
/** Skill cooldown reduction from Agility: about 14% at 100, 27% at 300 (skills use it, #143). */
export const COOLDOWN_CURVE: Curve = { max: 0.5, half: 250 };
/** Iron Body's reflect from Body: about 9% at 100, rising slowly toward 40%. */
export const REFLECT_CURVE: Curve = { max: 0.4, half: 345 };

/**
 * Attacks a second from Agility, on a log curve with no limit of its own:
 * 1 at 0, 1.75 at 100, 2.5 at 300, about 3.1 at 600.
 */
export const ATTACK_SPEED_SCALE = 0.75 / Math.LN2;
export const ATTACK_SPEED_HALF = 100;

export function agilityAttacks(agility: number): number {
  return 1 + ATTACK_SPEED_SCALE * Math.log1p(Math.max(0, agility) / ATTACK_SPEED_HALF);
}

/** Where the attack-speed curve gains half what its first point did. */
export const ATTACK_SPEED_SLOWS_AT = ATTACK_SPEED_HALF;

/** Flowing Sword (Sword Cultivator): crit damage per point of Agility. */
export const FLOWING_SWORD_CRIT_DAMAGE = 0.005;
/** Flowing Sword raises the attack-speed limit from 4 to 5 a second. */
export const FLOWING_SWORD_MIN_INTERVAL = 0.2;
/** Iron Body (Body Refiner): lifesteal per point of Body. */
export const IRON_BODY_LIFESTEAL = 0.001;
/** Talisman Resonance (Talisman Master): burst damage per point of Spirit, as a share. */
export const RESONANCE_BURST = 0.01;
/** Talisman Resonance: the share of a burst that splashes onto the next enemy waiting. */
export const RESONANCE_SPLASH = 0.5;

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
  /** Qi held, 0 to the derived maxQi. */
  qi: number;
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
  /** The qi pool: a base plus Spirit (in full for a Talisman Master, half for the others). */
  maxQi: number;
  /** Chance that an enemy's attack misses. */
  dodge: number;
  /** Share of each hit that ignores the enemy's defence. */
  pierce: number;
  /** Share of damage taken dealt back to the attacker (Iron Body). */
  reflect: number;
  /** HP healed a second, in fights and between them. */
  hpRegen: number;
  /** Share taken off skill cooldowns; carried for the skills (#143), combat ignores it. */
  cooldownReduction: number;
  /** Damage multiplier of a burst (Talisman Master); 1 without one. */
  burstMultiplier: number;
  /** Share of a burst that splashes onto the next enemy waiting (Talisman Resonance). */
  splash: number;
  /** Qi regained per second: the base, the Qi regen stat as a share of max qi, and Spirit (as for maxQi). */
  qiRegen: number;
  stoneFind: number;
  /** Raises the chance that a kill drops an item. */
  treasureFind: number;
}

export function derive(c: Pick<Cultivator, 'path' | 'level' | 'stats' | 'equipment'>): Derived {
  const stats = effectiveStats(c);
  const { body, agility, spirit } = stats;
  const path = PATHS[c.path];
  const b = equipmentBonuses(c.equipment);
  const realm = REALM_BONUS * realmOf(c.level);
  const sword = c.path === 'sword';
  const iron = c.path === 'body';
  const talisman = c.path === 'talisman';
  const minInterval = sword ? FLOWING_SWORD_MIN_INTERVAL : MIN_ATTACK_INTERVAL;
  // Each stat's effects, scaled by the Path share; the Masteries below are
  // the main stat's own, so always full.
  const bodyShare = pathShare(c.path, 'body');
  const agilityShare = pathShare(c.path, 'agility');
  const spiritShare = pathShare(c.path, 'spirit');
  const attacks = 1 + (agilityAttacks(agility) - 1) * agilityShare;
  // Spirit gives a Talisman Master its full qi, the other Paths half.
  const qiSpirit = path.qiFromSpirit * spirit;
  const maxQi = Math.round(BASE_MAX_QI + MAX_QI_PER_SPIRIT * qiSpirit);
  return {
    maxHp: Math.round((40 + HP_PER_BODY * bodyShare * body + b.maxHp) * (1 + b.maxHpPct + realm)),
    defence: DEFENCE_PER_BODY * bodyShare * body + b.defence,
    damage:
      (4 + DAMAGE_PER_MAIN * stats[path.primary] + b.damage) *
      (1 + b.damagePct + realm) *
      path.damageMultiplier,
    attackInterval: Math.max(minInterval, 1 / (attacks + b.attackSpeed)),
    // A chance: never above certain.
    critChance: Math.min(1, CRIT_BASE + curve(CRIT_CURVE, agility) * agilityShare + b.critChance),
    critMultiplier:
      path.critMultiplier + b.critDamage + (sword ? FLOWING_SWORD_CRIT_DAMAGE * agility : 0),
    lifesteal: Math.min(
      MAX_LIFESTEAL,
      path.lifesteal + b.lifesteal + (iron ? IRON_BODY_LIFESTEAL * body : 0),
    ),
    dodge: curve(DODGE_CURVE, agility) * agilityShare,
    pierce: curve(PIERCE_CURVE, spirit) * spiritShare,
    reflect: iron ? curve(REFLECT_CURVE, body) : 0,
    hpRegen: HP_REGEN_PER_BODY * bodyShare * body,
    cooldownReduction: curve(COOLDOWN_CURVE, agility) * agilityShare,
    burstMultiplier: path.burstMultiplier * (talisman ? 1 + RESONANCE_BURST * spirit : 1),
    splash: talisman ? RESONANCE_SPLASH : 0,
    maxQi,
    qiRegen: QI_BASE_REGEN + b.qiRegen * maxQi + QI_PER_SPIRIT * qiSpirit,
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

/** A level 1 cultivator; `bonusPoints` (from Dao Insight passives) come unspent. */
export function newCultivator(path: PathId, bonusPoints = 0): Cultivator {
  const stats: Stats = { body: BASE_STAT, agility: BASE_STAT, spirit: BASE_STAT };
  stats[PATHS[path].primary] += STARTING_PRIMARY_BONUS;
  const c: Cultivator = {
    path,
    level: 1,
    xp: 0,
    stats,
    unspent: bonusPoints,
    equipment: {},
    hp: 0,
    qi: 0,
    nextAttackAt: 0,
    attackCount: 0,
  };
  c.hp = derive(c).maxHp;
  return c;
}

// The Auto-assign plan (docs/design.md §3): a ratio across the three stats,
// in whole percent adding up to 100, that new points follow while it is on.

/** A Path's plan: its ratio, and the rounding carried from point to point. */
export interface PlanSlot {
  ratio: Stats;
  /** Smooth round robin credit per stat, in percent; always adds up to 0. */
  carry: Stats;
}

/** The ratio a plan starts at: all of it on the Path's main stat. */
export function defaultRatio(path: PathId): Stats {
  const ratio: Stats = { body: 0, agility: 0, spirit: 0 };
  ratio[PATHS[path].primary] = 100;
  return ratio;
}

export function zeroCarry(): Stats {
  return { body: 0, agility: 0, spirit: 0 };
}

/**
 * Whether `v` is a ratio a player may set: a plain object with exactly the
 * three stats, each a whole number from 0 to 100, adding up to 100.
 */
export function isRatio(v: unknown): v is Stats {
  if (typeof v !== 'object' || v === null || Object.getPrototypeOf(v) !== Object.prototype) {
    return false;
  }
  const keys = Object.keys(v);
  if (keys.length !== STAT_IDS.length || !STAT_IDS.every((id) => keys.includes(id))) return false;
  const o = v as Record<string, unknown>;
  const ok = STAT_IDS.every((id) => {
    const n = o[id];
    return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100;
  });
  return ok && STAT_IDS.reduce((sum, id) => sum + (o[id] as number), 0) === 100;
}

/**
 * Whether `carry` is one the round robin can reach for `ratio`: whole numbers
 * adding up to 0, each above -100 and below 100.
 */
export function isCarry(v: unknown): v is Stats {
  if (typeof v !== 'object' || v === null || Object.getPrototypeOf(v) !== Object.prototype) {
    return false;
  }
  const keys = Object.keys(v);
  if (keys.length !== STAT_IDS.length || !STAT_IDS.every((id) => keys.includes(id))) return false;
  const o = v as Record<string, unknown>;
  const ok = STAT_IDS.every((id) => {
    const n = o[id];
    return typeof n === 'number' && Number.isInteger(n) && n > -100 && n < 100;
  });
  return ok && STAT_IDS.reduce((sum, id) => sum + (o[id] as number), 0) === 0;
}

/**
 * The stat the plan's next point goes to: a smooth weighted round robin. Each
 * point adds every stat's share to its credit and goes to the one with the
 * most (ties to the earlier stat), which then pays 100. Over any 100 points
 * each stat gets exactly its share, and never strays a point from it between.
 */
export function nextPlanStat(plan: PlanSlot): StatId {
  let best: StatId = 'body';
  for (const id of STAT_IDS) {
    plan.carry[id] += plan.ratio[id];
    if (plan.carry[id] > plan.carry[best]) best = id;
  }
  plan.carry[best] -= 100;
  return best;
}

/** Spends `n` points by the plan, healing any max HP they add. */
export function spendByPlan(c: Cultivator, plan: PlanSlot, n: number): void {
  const before = derive(c).maxHp;
  for (let i = 0; i < n; i++) c.stats[nextPlanStat(plan)] += 1;
  c.hp += Math.max(0, derive(c).maxHp - before);
}

/**
 * Adds XP and applies every level-up it pays for, stopping at a realm cap:
 * XP past the cap is held until breakThrough(). Each level's stat points are
 * left unspent, or follow `plan` when Auto-assign is on; any max HP gained is
 * also healed.
 */
export function gainXp(c: Cultivator, xp: number, plan: PlanSlot | null = null): void {
  // Held XP never passes what a save can store as a whole number.
  c.xp = Math.min(Number.MAX_SAFE_INTEGER, c.xp + xp);
  while (!isRealmCap(c.level) && c.xp >= xpToNext(c.level)) levelUp(c, plan);
}

/**
 * The Tribulation was won: passes the cap into the next realm (whose bonus
 * comes with the level), then spends the rest of the held XP.
 */
export function breakThrough(c: Cultivator, plan: PlanSlot | null = null): void {
  if (!readyForTribulation(c)) throw new RangeError(`breakThrough: not ready at ${c.level}`);
  levelUp(c, plan);
  gainXp(c, 0, plan);
}

function levelUp(c: Cultivator, plan: PlanSlot | null): void {
  const before = derive(c).maxHp;
  c.xp -= xpToNext(c.level);
  c.level += 1;
  if (plan) {
    for (let i = 0; i < STAT_POINTS_PER_LEVEL; i++) c.stats[nextPlanStat(plan)] += 1;
  } else {
    c.unspent += STAT_POINTS_PER_LEVEL;
  }
  c.hp += derive(c).maxHp - before;
}
