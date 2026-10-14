// The skill engine's data: what a skill is, the effects it is built from, the
// per-fight status each fighter carries, and the shared "uses it when" rules
// (docs/design.md §5 Skills). Pure: sim.ts plays the casts on its event queue.

import type { EnemyKind } from './floors.ts';

/** Who a skill or effect belongs to: the cultivator or the enemy in front. */
export type Side = 'you' | 'foe';

/**
 * What the shared rules treat a skill as: a damage skill is held off an enemy
 * the next normal hit kills, a defensive one waits for low HP or a wind-up.
 */
export type SkillKind = 'damage' | 'defensive' | 'other';

/** A stat a buff or debuff moves, as a share: +0.4 attack speed is 40% faster. */
export type ModStat =
  'attackSpeed' | 'damage' | 'defence' | 'critChance' | 'damageTaken' | 'lifesteal';

/** The building blocks a skill is made of, applied in order when it lands. */
export type Effect =
  /**
   * `hits` hits at `mult` × the caster's normal hit. `crit` rolls the
   * cultivator's crit (an enemy never crits); `spill` also hits the next
   * `count` enemies waiting in the wave, at their own multiplier.
   */
  | {
      type: 'hit';
      mult: number;
      hits?: number;
      crit?: 'roll' | 'always' | 'never';
      spill?: { count: number; mult: number };
    }
  /** A buff (`on: 'self'`) or a debuff (`on: 'other'`) for `duration` seconds. */
  | { type: 'mod'; stat: ModStat; amount: number; duration: number; on: 'self' | 'other' }
  /** Absorbs damage worth `share` of the caster's max HP, for `duration` seconds. */
  | { type: 'shield'; share: number; duration: number }
  /** Heals `share` of the caster's max HP. */
  | { type: 'heal'; share: number }
  /** The other side can't attack or cast; it cancels a wind-up. */
  | { type: 'stun'; duration: number }
  /** The other side can't cast. */
  | { type: 'silence'; duration: number }
  /** Takes up to `amount` qi from the other side; `steal` gives it to the caster. */
  | { type: 'drain'; amount: number; steal: boolean }
  /** Sends `share` of the damage the caster takes back at the attacker. */
  | { type: 'reflect'; share: number; duration: number }
  /** The caster's HP can't drop below 1. */
  | { type: 'endure'; duration: number };

/** What a "uses it when" rule may look at. */
export interface SkillContext {
  side: Side;
  /** The caster and the other side, as rules need them. */
  self: FighterView;
  other: FighterView;
  /** The kind of enemy being fought: rule 1 reads it. */
  foeKind: EnemyKind;
  /** Enemies left in the wave, the one in front included. */
  waveLeft: number;
}

export interface FighterView {
  hp: number;
  maxHp: number;
  qi: number;
  maxQi: number;
  /** True while this side winds up a skill. */
  windingUp: boolean;
  /** Seconds since the fight started. */
  fightTime: number;
}

export interface SkillDef {
  id: string;
  /** The English name, translated like enemy names (the UI's 'skill' names). */
  name: string;
  /** Qi spent on the cast. */
  qi: number;
  /** Seconds before it can be cast again; 0 for none (the qi cost is the limit). */
  cooldown: number;
  kind: SkillKind;
  /** Seconds an enemy winds up before it lands; WIND_UP when left out. The cultivator never winds up. */
  windUp?: number;
  effects: readonly Effect[];
  /** The skill's own "uses it when" rule, on top of the shared ones. */
  when: (ctx: SkillContext) => boolean;
}

/** Most of a seeded pause before any cast, so casting never looks robotic. */
export const CAST_PAUSE = 0.8;
/** Seconds an enemy skill winds up by default. */
export const WIND_UP = 1;
/** A cheap skill is held while a bigger one is this close (rule 1). */
export const HOLD_WITHIN_QI = 20;
/** Defensive skills wait for HP at or below this share of max HP, or a wind-up (rule 3). */
export const DEFENSIVE_HP_SHARE = 0.6;
/** Cast and effect notes kept for the strip's callouts. */
export const LOG_SIZE = 8;

/** The callouts an effect floats over the fighter it hit. */
export type EffectNote = 'stunned' | 'silenced' | 'shielded' | 'interrupted';

/**
 * One callout for the strip: `who` is the fighter it floats over. A cast
 * carries the skill's name; `windUp` marks an enemy starting one.
 */
export type NewNote =
  | { at: number; who: Side; skill: string; windUp: boolean }
  | { at: number; who: Side; effect: EffectNote };

/** A callout numbered by note(), so two at the same time still differ. */
export type CastNote = NewNote & { id: number };

/** A buff or debuff on a fighter, until sim time `until`. */
export interface Mod {
  stat: ModStat;
  amount: number;
  until: number;
}

/** A fighter's skill state; it lives for one fight. */
export interface Status {
  mods: Mod[];
  shield: number;
  shieldUntil: number;
  stunUntil: number;
  silenceUntil: number;
  reflect: number;
  reflectUntil: number;
  endureUntil: number;
  /** Sim time each skill (by id) is ready again; a missing id is ready. */
  cooldowns: Record<string, number>;
  /** Casts of each skill (by id) this fight, for skills that grow with use. */
  uses: Record<string, number>;
  /** A cast chosen and waiting out its pause. */
  pending: { skill: string; at: number } | null;
  /** An enemy skill winding up, landing at `end`. */
  windUp: { skill: string; name: string; start: number; end: number } | null;
}

/**
 * Skill state for the current fight. It is never saved: a fight's buffs,
 * shields, cooldowns and wind-ups end with it (docs/design.md §5 Skills).
 */
export interface Combat {
  /** Counts fights, so code mid-event can tell the fight it was in has ended. */
  fight: number;
  /** Sim time the fight starts, after the arrival pause; nobody casts before. */
  fightAt: number;
  you: Status;
  foe: Status;
  /** The latest callouts, oldest first; kept across fights so the strip can show the last ones. */
  log: CastNote[];
  /** The id the next callout gets. */
  nextNote: number;
}

export function freshStatus(): Status {
  return {
    mods: [],
    shield: 0,
    shieldUntil: 0,
    stunUntil: 0,
    silenceUntil: 0,
    reflect: 0,
    reflectUntil: 0,
    endureUntil: 0,
    cooldowns: {},
    uses: {},
    pending: null,
    windUp: null,
  };
}

/** A new fight's skill state; the callouts carry over from `last`. */
export function freshCombat(fightAt = 0, last?: Combat): Combat {
  return {
    fight: (last?.fight ?? 0) + 1,
    fightAt,
    you: freshStatus(),
    foe: freshStatus(),
    log: last?.log ?? [],
    nextNote: last?.nextNote ?? 0,
  };
}

/** The total of a stat's active buffs and debuffs at `now`. */
export function modTotal(status: Status, stat: ModStat, now: number): number {
  let total = 0;
  for (const m of status.mods) if (m.stat === stat && m.until > now) total += m.amount;
  return total;
}

/** A multiplier from a stat's mods, never below 0. */
export function modFactor(status: Status, stat: ModStat, now: number): number {
  return Math.max(0, 1 + modTotal(status, stat, now));
}

/** Seconds between attacks under attack speed mods; never faster than a tenth of `interval`. */
export function modInterval(status: Status, interval: number, now: number): number {
  return interval / Math.max(0.1, 1 + modTotal(status, 'attackSpeed', now));
}

export function stunned(status: Status, now: number): boolean {
  return status.stunUntil > now;
}

export function silenced(status: Status, now: number): boolean {
  return status.silenceUntil > now;
}

/** The active shield at `now`, 0 once it ran out. */
export function shieldLeft(status: Status, now: number): number {
  return status.shieldUntil > now ? status.shield : 0;
}

export function enduring(status: Status, now: number): boolean {
  return status.endureUntil > now;
}

export function reflectShare(status: Status, now: number): number {
  return status.reflectUntil > now ? status.reflect : 0;
}

export function onCooldown(status: Status, id: string, now: number): boolean {
  return Object.hasOwn(status.cooldowns, id) && (status.cooldowns[id] as number) > now;
}

/** A cooldown cut by `reduction` (a share, 0 to under 1). */
export function cooldownFor(def: SkillDef, reduction: number): number {
  return def.cooldown * (1 - Math.min(0.95, Math.max(0, reduction)));
}

/** Adds a callout, dropping the oldest past LOG_SIZE. */
export function note(combat: Combat, entry: NewNote): void {
  combat.log.push({ ...entry, id: combat.nextNote++ });
  if (combat.log.length > LOG_SIZE) combat.log.splice(0, combat.log.length - LOG_SIZE);
}

/** True for an elite, a boss or a Tribulation. */
export function eliteOrTougher(kind: EnemyKind): boolean {
  return kind !== 'demon';
}

/** What the shared rules need beyond the rule context. */
export interface RuleInputs {
  ctx: SkillContext;
  status: Status;
  now: number;
  /** True when the caster's next normal (non-crit) hit kills the other side. */
  nextHitKills: boolean;
}

/**
 * Whether `def` may be cast now: enough qi, off cooldown, not stunned or
 * silenced, the three shared rules and its own rule all hold.
 *
 * 1. The cultivator holds a cheap skill (not a defensive one) while a bigger
 *    skill off cooldown is within HOLD_WITHIN_QI qi, against an elite or tougher.
 * 2. A damage skill is not spent when the next normal hit kills.
 * 3. A defensive skill waits for HP at or below DEFENSIVE_HP_SHARE, or the
 *    other side winding up.
 */
export function usable(def: SkillDef, loadout: readonly SkillDef[], r: RuleInputs): boolean {
  const { ctx, status, now } = r;
  if (ctx.self.qi < def.qi || onCooldown(status, def.id, now)) return false;
  if (stunned(status, now) || silenced(status, now)) return false;
  if (ctx.side === 'you' && def.kind !== 'defensive' && eliteOrTougher(ctx.foeKind)) {
    const held = loadout.some(
      (big) =>
        big.qi > def.qi &&
        !onCooldown(status, big.id, now) &&
        ctx.self.qi < big.qi &&
        ctx.self.qi + HOLD_WITHIN_QI >= big.qi,
    );
    if (held) return false;
  }
  if (def.kind === 'damage' && r.nextHitKills) return false;
  if (
    def.kind === 'defensive' &&
    !ctx.other.windingUp &&
    ctx.self.hp > ctx.self.maxHp * DEFENSIVE_HP_SHARE
  ) {
    return false;
  }
  return def.when(ctx);
}

/** The skill to cast now: the costliest usable one, ties in loadout order; null for none. */
export function chooseSkill(loadout: readonly SkillDef[], r: RuleInputs): SkillDef | null {
  let best: SkillDef | null = null;
  for (const def of loadout) {
    if ((best === null || def.qi > best.qi) && usable(def, loadout, r)) best = def;
  }
  return best;
}
