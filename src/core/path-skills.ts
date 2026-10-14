// The Path skills (docs/design.md §5 Path skills): four per Path, the first
// learned in Qi Condensation and one new skill or upgrade at each of the nine
// breakthroughs. Derived from the Path and realm, never saved, so a Path
// change, a Reincarnation or an older save has the right ones at once.

import { PATH_IDS, REALMS, type PathId } from './cultivator.ts';
import {
  bossOrTougher,
  eliteOrTougher,
  type Effect,
  type SkillContext,
  type SkillDef,
} from './skills.ts';

/** Realm indices (into REALMS), by name, for the tables below. */
const QC = 0;
const FE = 1;
const GC = 2;
const NS = 3;
const ST = 4;
const VR = 5;
const BI = 6;
const MA = 7;
const TT = 8;
const IA = 9;

/** Seconds from the start of a fight that count as its start (Sword Intent's rule). */
export const FIGHT_START = 1;
/** "HP is low" for Blood Qi Surge. */
export const SURGE_HP_SHARE = 0.4;
/** Vajra Body steps in when a hit would take HP below this share. */
export const VAJRA_HP_SHARE = 0.2;
/** An enemy below this share of max HP is low (Ten Thousand Swords). */
export const LOW_HP_SHARE = 0.3;
/** Sword Intent wants an enemy above this share of max HP. */
export const INTENT_HP_SHARE = 0.5;
/** Sealing Talisman wants an enemy's qi above this share of its max. */
export const SEAL_QI_SHARE = 0.7;

/**
 * One Path skill: the realms where it is learned (the first) and upgraded
 * (the rest), and what it is at each rank (1 once learned, 2 after the
 * first upgrade, …).
 */
interface Ladder {
  id: string;
  steps: readonly number[];
  make: (rank: number) => SkillDef;
}

/** A Path skill's base: no cooldown (the qi cost is the limit). */
function def(
  id: string,
  name: string,
  qi: number,
  kind: SkillDef['kind'],
  effects: Effect[],
  when: (ctx: SkillContext) => boolean,
  urgent?: (ctx: SkillContext) => boolean,
): SkillDef {
  return { id, name, qi, cooldown: 0, kind, effects, when, ...(urgent ? { urgent } : {}) };
}

const always = (): boolean => true;

/** The other side's next normal hit would take HP below VAJRA_HP_SHARE. */
function lethal(ctx: SkillContext): boolean {
  return ctx.self.hp - ctx.incoming < ctx.self.maxHp * VAJRA_HP_SHARE;
}

const SWORD: readonly Ladder[] = [
  {
    id: 'flyingSword',
    steps: [QC, GC, MA],
    make: (rank) =>
      def(
        'flyingSword',
        'Flying Sword',
        30,
        'damage',
        [
          {
            type: 'hit',
            ...(rank >= 2 ? { mult: 1.5, hits: 2 } : { mult: 2.5 }),
            crit: 'always',
            ...(rank >= 3 ? { refund: 0.5 } : {}),
          },
        ],
        // Shared rule 1 holds it while Ten Thousand Swords is within 20 qi.
        always,
      ),
  },
  {
    id: 'swordIntent',
    steps: [FE, ST, IA],
    make: (rank) => {
      const duration = rank >= 3 ? 10 : 6;
      return def(
        'swordIntent',
        'Sword Intent',
        rank >= 3 ? 35 : 45,
        'other',
        [
          { type: 'mod', stat: 'attackSpeed', amount: 0.4, duration, on: 'self' },
          ...(rank >= 2
            ? [{ type: 'mod', stat: 'critChance', amount: 0.15, duration, on: 'self' } as const]
            : []),
        ],
        (ctx) =>
          (eliteOrTougher(ctx.foeKind) && ctx.self.fightTime <= FIGHT_START) ||
          ctx.other.hp > ctx.other.maxHp * INTENT_HP_SHARE,
      );
    },
  },
  {
    id: 'lightningStep',
    steps: [NS, BI],
    make: (rank) =>
      def(
        'lightningStep',
        'Lightning Step',
        35,
        'defensive',
        [{ type: 'evade', hits: 2, ...(rank >= 2 ? { counter: true } : {}) }],
        // Shared rule 3: a wind-up or low HP; never while it still has dodges.
        (ctx) => ctx.self.evades === 0,
      ),
  },
  {
    id: 'tenThousandSwords',
    steps: [VR, TT],
    make: (rank) =>
      def(
        'tenThousandSwords',
        'Ten Thousand Swords',
        90,
        'damage',
        [{ type: 'hit', mult: 1, hits: rank >= 2 ? 8 : 6, low: { below: LOW_HP_SHARE, mult: 2 } }],
        (ctx) =>
          bossOrTougher(ctx.foeKind) ||
          (eliteOrTougher(ctx.foeKind) && ctx.other.hp < ctx.other.maxHp * LOW_HP_SHARE),
      ),
  },
];

const BODY: readonly Ladder[] = [
  {
    id: 'ironSkin',
    steps: [QC, GC, MA],
    make: (rank) =>
      def(
        'ironSkin',
        'Iron Skin',
        rank >= 3 ? 20 : 30,
        'defensive',
        [
          { type: 'mod', stat: 'defence', amount: 0.6, duration: 6, on: 'self' },
          ...(rank >= 2 ? [{ type: 'reflect', share: 0.25, duration: 6 } as const] : []),
        ],
        // Shared rule 3: a wind-up or low HP.
        always,
      ),
  },
  {
    id: 'mountainFist',
    steps: [FE, ST, IA],
    make: (rank) =>
      def(
        'mountainFist',
        rank >= 3 ? 'Mountain-Toppling Palm' : 'Mountain Fist',
        40,
        'damage',
        [
          {
            type: 'hit',
            mult: rank >= 3 ? 3 : 2,
            ...(rank >= 2 ? { maxHp: rank >= 3 ? 0.15 : 0.1 } : {}),
          },
          { type: 'stun', duration: rank >= 2 ? 1.5 : 1 },
        ],
        (ctx) => ctx.other.windingUp || ctx.self.qi >= ctx.self.maxQi,
      ),
  },
  {
    id: 'bloodQiSurge',
    steps: [NS, BI],
    make: (rank) =>
      def(
        'bloodQiSurge',
        'Blood Qi Surge',
        55,
        'defensive',
        [
          { type: 'heal', share: 0.25 },
          ...(rank >= 2
            ? [
                {
                  type: 'mod',
                  stat: 'lifesteal',
                  amount: 1,
                  duration: 6,
                  on: 'self',
                  relative: true,
                } as const,
              ]
            : []),
        ],
        (ctx) => ctx.self.hp < ctx.self.maxHp * SURGE_HP_SHARE,
      ),
  },
  {
    id: 'vajraBody',
    steps: [VR, TT],
    make: (rank) =>
      def(
        'vajraBody',
        'Vajra Body',
        80,
        'defensive',
        [{ type: 'endure', duration: rank >= 2 ? 6 : 4, heal: 0.1 }],
        (ctx) => lethal(ctx) || (bossOrTougher(ctx.foeKind) && ctx.other.windingUp),
        // A hit that would take HP below 20% is cast against even from above 60%.
        lethal,
      ),
  },
];

const TALISMAN: readonly Ladder[] = [
  {
    id: 'fireTalisman',
    steps: [QC, NS, TT],
    make: (rank) =>
      def(
        'fireTalisman',
        'Fire Talisman',
        rank >= 3 ? 20 : 30,
        'damage',
        [
          { type: 'hit', mult: 2.2 },
          { type: 'burn', mult: 0.5, duration: 3, ...(rank >= 2 ? { stack: true } : {}) },
        ],
        // A new burn would only replace the last one, until burns stack.
        rank >= 2 ? always : (ctx) => !ctx.other.burning,
      ),
  },
  {
    id: 'thunderTalisman',
    steps: [FE, VR, IA],
    make: (rank) =>
      def(
        'thunderTalisman',
        rank >= 3 ? 'Heavenly Thunder Array' : 'Thunder Talisman',
        45,
        'damage',
        [
          rank >= 3
            ? { type: 'hit', mult: 2, spill: { count: Infinity, mult: 2 } }
            : { type: 'hit', mult: 1.8, spill: { count: rank >= 2 ? 3 : 1, mult: 0.9 } },
        ],
        // Enemies the spill can reach: never a Tribulation waiting at the end.
        (ctx) => ctx.reachable >= 2 || bossOrTougher(ctx.foeKind),
      ),
  },
  {
    id: 'spiritShield',
    steps: [GC, BI],
    make: (rank) =>
      def(
        'spiritShield',
        'Spirit Shield',
        40,
        'defensive',
        [{ type: 'shield', share: 0.2, duration: 8, ...(rank >= 2 ? { burst: 1 } : {}) }],
        // Shared rule 3: HP at or below 60%, or a wind-up.
        always,
      ),
  },
  {
    id: 'sealingTalisman',
    steps: [ST, MA],
    make: (rank) =>
      def(
        'sealingTalisman',
        'Sealing Talisman',
        50,
        'other',
        [
          { type: 'drain', amount: Infinity, steal: rank >= 2 },
          { type: 'silence', duration: rank >= 2 ? 8 : 5 },
        ],
        (ctx) =>
          eliteOrTougher(ctx.foeKind) &&
          ctx.other.maxQi > 0 &&
          ctx.other.qi > ctx.other.maxQi * SEAL_QI_SHARE,
      ),
  },
];

const LADDERS: Readonly<Record<PathId, readonly Ladder[]>> = {
  sword: SWORD,
  body: BODY,
  talisman: TALISMAN,
};

/** The rank of `ladder` at realm `realm`: 0 before it is learned. */
function rankAt(ladder: Ladder, realm: number): number {
  return ladder.steps.filter((r) => r <= realm).length;
}

/** Every Path's skills at every realm, built once: the sim asks at every event. */
function build(path: PathId): readonly (readonly SkillDef[])[] {
  return REALMS.map((_, realm) =>
    LADDERS[path].flatMap((l) => {
      const rank = rankAt(l, realm);
      return rank > 0 ? [l.make(rank)] : [];
    }),
  );
}

const BUILT: Readonly<Record<PathId, readonly (readonly SkillDef[])[]>> = {
  sword: build('sword'),
  body: build('body'),
  talisman: build('talisman'),
};

/** The skills a cultivator of `path` knows in realm `realm` (an index into REALMS), learned order. */
export function pathSkills(path: PathId, realm: number): readonly SkillDef[] {
  const byRealm = BUILT[path];
  const r = Math.min(REALMS.length - 1, Math.max(0, Math.floor(realm)));
  return byRealm[r] ?? [];
}

/** What a realm brings a Path: the skill learned or upgraded there, and its rank (1 = learned). */
export interface PathStep {
  id: string;
  name: string;
  rank: number;
}

/** The step realm `realm` brings `path`; every realm brings exactly one. */
export function pathStep(path: PathId, realm: number): PathStep | null {
  for (const l of LADDERS[path]) {
    if (!l.steps.includes(realm)) continue;
    const rank = rankAt(l, realm);
    return { id: l.id, name: l.make(rank).name, rank };
  }
  return null;
}

/** Every Path skill's name, an upgrade's new name included, for the language packs. */
export const PATH_SKILL_NAMES: readonly string[] = [
  ...new Set(
    PATH_IDS.flatMap((path) =>
      LADDERS[path].flatMap((l) => l.steps.map((_, i) => l.make(i + 1).name)),
    ),
  ),
];
