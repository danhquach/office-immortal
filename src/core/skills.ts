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
      /** A hit on an enemy below `below` of its max HP deals `mult` times as much. */
      low?: { below: number; mult: number };
      /** Adds this share of the caster's max HP to each hit; it never crits. */
      maxHp?: number;
      /** A kill by this effect gives back this share of the skill's qi, once a cast. */
      refund?: number;
    }
  /**
   * A buff (`on: 'self'`) or a debuff (`on: 'other'`) for `duration` seconds.
   * `relative` scales `amount` by the target's own value of a share stat
   * (lifesteal, crit chance): +1 relative lifesteal doubles it.
   */
  | {
      type: 'mod';
      stat: ModStat;
      amount: number;
      duration: number;
      on: 'self' | 'other';
      relative?: boolean;
    }
  /**
   * Absorbs damage worth `share` of the caster's max HP, for `duration`
   * seconds. With `burst`, damage breaking it deals that share of its worth
   * to the other side, past its defence.
   */
  | { type: 'shield'; share: number; duration: number; burst?: number }
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
  /** The caster's HP can't drop below 1; `heal` is a share of max HP healed as it ends. */
  | { type: 'endure'; duration: number; heal?: number }
  /**
   * The caster turns aside the next `hits` normal attacks, or the next skill
   * of the other side (which uses them all up); `counter` answers each one
   * with a crit at the normal hit.
   */
  | { type: 'evade'; hits: number; counter?: boolean }
  /**
   * Burns the other side for `mult` × the caster's normal hit in all, over
   * `duration` seconds, a tick each BURN_TICK through defence. A new burn
   * replaces the last unless `stack`.
   */
  | { type: 'burn'; mult: number; duration: number; stack?: boolean };

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
  /** Of those, the ones a spill can reach (a waiting Tribulation can't be), the one in front included. */
  reachable: number;
  /** HP the other side's next normal hit takes off the caster, after defence. */
  incoming: number;
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
  /** True while a burn is on this side. */
  burning: boolean;
  /** Normal attacks this side will still turn aside (an evade effect). */
  evades: number;
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
  /** For a defensive skill: when this holds, rule 3's HP-or-wind-up gate is skipped. */
  urgent?: (ctx: SkillContext) => boolean;
}

/** Most of a seeded pause before any cast, so casting never looks robotic. */
export const CAST_PAUSE = 0.8;
/** Seconds an enemy skill winds up by default. */
export const WIND_UP = 1;
/** A cheap skill is held while a bigger one is this close (rule 1). */
export const HOLD_WITHIN_QI = 20;
/** Defensive skills wait for HP at or below this share of max HP, or a wind-up (rule 3). */
export const DEFENSIVE_HP_SHARE = 0.6;
/** Seconds between a burn's ticks. */
export const BURN_TICK = 1;
/** Burns that stack on one fighter at most; a new one past it replaces the oldest. */
export const MAX_BURNS = 3;
/**
 * Skill damage the cultivator gains per point of Spirit (after the realm
 * bonus), as a share, on every Path alike (docs/design.md §5 Skills).
 */
export const SKILL_DAMAGE_PER_SPIRIT = 0.001;
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

/** A buff or debuff on a fighter, until sim time `until`; `source` is the skill (by id) that put it. */
export interface Mod {
  stat: ModStat;
  amount: number;
  until: number;
  source?: string;
}

/** A burn on a fighter: `damage` a tick before defence, `left` ticks, the next at `next`. */
export interface Burn {
  damage: number;
  left: number;
  next: number;
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
  /** Share of max HP healed as the endure ends; 0 for none. */
  endureHeal: number;
  /** Damage the shield deals back when it breaks; 0 for none. */
  shieldBurst: number;
  /** A broken shield's burst, waiting to be dealt after the hit that broke it. */
  burstDue: number;
  /** Normal attacks still turned aside, and whether each is answered with a crit. */
  evades: number;
  counter: boolean;
  /** Burns on this fighter, oldest first. */
  burns: Burn[];
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
    endureHeal: 0,
    shieldBurst: 0,
    burstDue: 0,
    evades: 0,
    counter: false,
    burns: [],
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

/** True for a boss or a Tribulation. */
export function bossOrTougher(kind: EnemyKind): boolean {
  return kind === 'boss' || kind === 'tribulation';
}

/** True for an effect that only buffs its caster: a buff, a shield, a reflect, an endure, an evade. */
export function buffsSelf(e: Effect): boolean {
  switch (e.type) {
    case 'mod':
      return e.on === 'self';
    case 'shield':
    case 'reflect':
    case 'endure':
    case 'evade':
      return true;
    default:
      return false;
  }
}

/**
 * Rule 4: true while a skill made only of buffs on its caster still has one
 * of them working: its own buff not run out, a shield not broken or run out,
 * a reflect or endure running, evades left. A skill with any other effect
 * (a heal, a hit) is never held by the buffs it also gives.
 */
export function buffed(def: SkillDef, status: Status, now: number): boolean {
  if (def.effects.length === 0 || !def.effects.every(buffsSelf)) return false;
  return def.effects.some((e) => {
    switch (e.type) {
      case 'mod':
        return status.mods.some((m) => m.source === def.id && m.stat === e.stat && m.until > now);
      case 'shield':
        return shieldLeft(status, now) > 0;
      case 'reflect':
        return reflectShare(status, now) > 0;
      case 'endure':
        return enduring(status, now);
      case 'evade':
        return status.evades > 0;
      default:
        return false;
    }
  });
}

/** True for an effect that reaches the other side: an evade turns the whole lot aside. */
export function reachesOther(e: Effect): boolean {
  switch (e.type) {
    case 'hit':
    case 'stun':
    case 'silence':
    case 'drain':
    case 'burn':
      return true;
    case 'mod':
      return e.on === 'other';
    default:
      return false;
  }
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
 * silenced, the four shared rules and its own rule all hold.
 *
 * 1. The cultivator holds a cheap skill (not a defensive one) while a bigger
 *    skill is within HOLD_WITHIN_QI qi, against an elite or tougher, and
 *    that bigger skill would be cast once its qi is there: off cooldown, and
 *    rules 2 to 4 and its own rule hold for it (read at its cost in qi).
 * 2. A damage skill is not spent when the next normal hit kills.
 * 3. A defensive skill waits for HP at or below DEFENSIVE_HP_SHARE, or the
 *    other side winding up, unless its `urgent` rule holds.
 * 4. A skill made only of buffs on its caster is not cast again while one of
 *    them still works (buffed).
 */
export function usable(def: SkillDef, loadout: readonly SkillDef[], r: RuleInputs): boolean {
  const { ctx, status, now } = r;
  if (ctx.self.qi < def.qi || onCooldown(status, def.id, now)) return false;
  if (stunned(status, now) || silenced(status, now)) return false;
  if (ctx.side === 'you' && def.kind !== 'defensive' && eliteOrTougher(ctx.foeKind)) {
    const held = loadout.some(
      (big) =>
        big.qi > def.qi &&
        ctx.self.qi < big.qi &&
        ctx.self.qi + HOLD_WITHIN_QI >= big.qi &&
        !onCooldown(status, big.id, now) &&
        wouldCast(big, { ...r, ctx: { ...ctx, self: { ...ctx.self, qi: big.qi } } }),
    );
    if (held) return false;
  }
  return wouldCast(def, r);
}

/** Rules 2 to 4 and the skill's own rule. */
function wouldCast(def: SkillDef, r: RuleInputs): boolean {
  const { ctx, status, now } = r;
  if (buffed(def, status, now)) return false;
  if (def.kind === 'damage' && r.nextHitKills) return false;
  if (
    def.kind === 'defensive' &&
    !ctx.other.windingUp &&
    ctx.self.hp > ctx.self.maxHp * DEFENSIVE_HP_SHARE &&
    !(def.urgent?.(ctx) ?? false)
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
