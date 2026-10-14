// The elite, boss and Tribulation skills (docs/design.md §5 Elite and boss
// skills, §5 Tribulation skills): an elite has one, from the demon it is a
// variant of, a boss two, a Tribulation its signature skill plus Heavenly
// Lightning below half HP, a regular demon none. Every one winds up first
// (WIND_UP unless it sets its own), so the cultivator's defensive and stun
// skills can answer it.

import { BOSSES, DEMONS, TRIBULATIONS, type Enemy } from './floors.ts';
import type { SkillContext, SkillDef } from './skills.ts';

/** Quarterly Judgement Palm's long wind-up, in seconds. */
export const MISSED_TARGETS_WIND_UP = 2.5;
/** Thousand Echo Reply Array's hits on its first cast; each cast after adds one. */
export const REPLY_ALL_HITS = 5;
/** Qi Confiscation Palm waits for the cultivator to hold at least this much qi. */
export const EXPENSE_MIN_QI = 25;
/** Heavenly Oversight Seal waits for the cultivator's qi at or above this share of its max. */
export const MICROMANAGE_QI_SHARE = 0.9;

const always = (): boolean => true;

/** Thousand Echo Reply Array, with one more hit for each cast before this one this fight. */
function replyAll(uses: number): SkillDef {
  // A cast counts from its wind-up (castNow), so the one landing is already in `uses`.
  const hits = REPLY_ALL_HITS + Math.max(0, uses - 1);
  return {
    id: 'replyAll',
    name: 'Thousand Echo Reply Array',
    qi: 40,
    cooldown: 0,
    kind: 'damage',
    effects: [{ type: 'hit', mult: 0.3, hits }],
    when: always,
  };
}

/** Each elite's skill, by the demon it is a variant of (Thousand Echo Reply Array is built per cast). */
const ELITES: Readonly<Record<Exclude<(typeof DEMONS)[number], 'Reply-All Swarm'>, SkillDef>> = {
  'Deadline Fiend': {
    id: 'crunchTime',
    name: 'Deadline Frenzy Art',
    qi: 40,
    cooldown: 0,
    kind: 'other',
    effects: [{ type: 'mod', stat: 'attackSpeed', amount: 0.5, duration: 5, on: 'self' }],
    // Shared rule 4: not again while the buff runs.
    when: always,
  },
  'Inbox Hydra': {
    id: 'unreadFlood',
    name: 'Ten Thousand Unread Scrolls',
    qi: 40,
    cooldown: 0,
    kind: 'damage',
    effects: [{ type: 'hit', mult: 0.6, hits: 3 }],
    when: always,
  },
  'Meeting Wraith': {
    id: 'couldBeEmail',
    name: 'Endless Meeting Domain',
    qi: 40,
    // Longer than the slow, so it is never cast over one still running.
    cooldown: 10,
    kind: 'other',
    effects: [{ type: 'mod', stat: 'attackSpeed', amount: -0.3, duration: 5, on: 'other' }],
    when: always,
  },
  'Printer Golem': {
    id: 'paperJam',
    name: 'Paper-Binding Seal',
    qi: 45,
    cooldown: 8,
    kind: 'other',
    effects: [{ type: 'stun', duration: 1.5 }],
    when: always,
  },
};

const BOSS_SKILLS: Readonly<Record<(typeof BOSSES)[number], readonly SkillDef[]>> = {
  'Quarterly Review': [
    {
      id: 'missedTargets',
      name: 'Quarterly Judgement Palm',
      qi: 60,
      cooldown: 0,
      kind: 'damage',
      windUp: MISSED_TARGETS_WIND_UP,
      effects: [{ type: 'hit', mult: 2.5 }],
      when: always,
    },
    {
      id: 'pip',
      name: 'Meridian-Sealing Review',
      qi: 40,
      // Longer than the debuff, so it is never cast over one still running.
      cooldown: 12,
      kind: 'other',
      effects: [{ type: 'mod', stat: 'damage', amount: -0.25, duration: 6, on: 'other' }],
      when: always,
    },
  ],
  'The Auditor': [
    {
      id: 'expenseDisallowed',
      name: 'Qi Confiscation Palm',
      qi: 50,
      cooldown: 0,
      kind: 'damage',
      effects: [
        { type: 'drain', amount: 50, steal: false },
        { type: 'hit', mult: 1 },
      ],
      when: (ctx: SkillContext) => ctx.other.qi >= EXPENSE_MIN_QI,
    },
    {
      id: 'fullAudit',
      name: 'Golden Ledger Body',
      qi: 40,
      cooldown: 10,
      kind: 'defensive',
      effects: [{ type: 'mod', stat: 'damageTaken', amount: -0.5, duration: 5, on: 'self' }],
      // Shared rule 3: HP at or below 60%; rule 4: not again while it runs.
      when: always,
    },
  ],
  'Middle Manager': [
    {
      id: 'delegation',
      name: 'Burden-Shifting Mirror',
      qi: 40,
      cooldown: 10,
      kind: 'other',
      effects: [{ type: 'reflect', share: 0.3, duration: 5 }],
      when: always,
    },
    {
      id: 'micromanage',
      name: 'Heavenly Oversight Seal',
      qi: 50,
      cooldown: 12,
      kind: 'other',
      effects: [{ type: 'silence', duration: 4 }],
      when: (ctx: SkillContext) => ctx.other.qi >= ctx.other.maxQi * MICROMANAGE_QI_SHARE,
    },
  ],
};

/** Heavenly Lightning comes below this share of a Tribulation's max HP. */
export const LIGHTNING_HP_SHARE = 0.5;
/** Heavenly Lightning's wind-up before each of its three strikes, in seconds. */
export const LIGHTNING_WIND_UP = 3;
/** Final Judgement's long wind-up, in seconds. */
export const FINAL_JUDGEMENT_WIND_UP = 3;
/** Asset Seizure waits for the cultivator to hold at least this much qi. */
export const SEIZURE_MIN_QI = 30;

/** Heavenly Lightning's name, which the strip flashes the stage for as each strike lands. */
export const LIGHTNING_NAME = 'Heavenly Lightning';

/** Heavenly Lightning: every Tribulation gains it below LIGHTNING_HP_SHARE of its max HP. */
const LIGHTNING: SkillDef = {
  id: 'heavenlyLightning',
  name: LIGHTNING_NAME,
  qi: 30,
  cooldown: 30,
  kind: 'damage',
  windUp: LIGHTNING_WIND_UP,
  strikes: 3,
  effects: [{ type: 'cut', share: 0.1, of: 'max' }],
  when: (ctx: SkillContext) => ctx.self.hp < ctx.self.maxHp * LIGHTNING_HP_SHARE,
};

/** Each Tribulation's signature skill. */
const SIGNATURES: Readonly<Record<(typeof TRIBULATIONS)[number], SkillDef>> = {
  'Probation Review': {
    id: 'finalWarning',
    name: 'Final Warning',
    qi: 30,
    cooldown: 0,
    kind: 'damage',
    // 100% at full HP, up to 200% near 0.
    effects: [{ type: 'hit', mult: 1, missing: 1 }],
    when: always,
  },
  'Annual Appraisal': {
    id: 'bellCurve',
    name: 'Bell Curve',
    qi: 30,
    cooldown: 0,
    kind: 'damage',
    effects: [{ type: 'cut', share: 0.2, of: 'current' }],
    when: always,
  },
  Restructuring: {
    id: 'redundancy',
    name: 'Redundancy',
    qi: 40,
    cooldown: 20,
    kind: 'other',
    effects: [{ type: 'purge' }],
    when: (ctx: SkillContext) => ctx.other.buffs > 0,
  },
  'Hostile Takeover': {
    id: 'assetSeizure',
    name: 'Asset Seizure',
    qi: 30,
    cooldown: 20,
    kind: 'other',
    effects: [{ type: 'drain', amount: 40, steal: true }],
    when: (ctx: SkillContext) => ctx.other.qi >= SEIZURE_MIN_QI,
  },
  'Shareholder Revolt': {
    id: 'noConfidence',
    name: 'Vote of No Confidence',
    qi: 40,
    // Longer than the silence, so it is never cast over one still running.
    cooldown: 20,
    kind: 'other',
    effects: [{ type: 'silence', duration: 2 }],
    when: always,
  },
  'Board Inquiry': {
    id: 'underInvestigation',
    name: 'Under Investigation',
    qi: 40,
    // Longer than the burn, so it is never cast over one still running.
    cooldown: 20,
    kind: 'damage',
    effects: [{ type: 'burn', mult: 1, duration: 5 }],
    when: always,
  },
  'Regulatory Probe': {
    id: 'complianceFreeze',
    name: 'Compliance Freeze',
    qi: 40,
    cooldown: 20,
    kind: 'other',
    effects: [{ type: 'stun', duration: 1.5 }],
    when: always,
  },
  'Market Crash': {
    id: 'freefall',
    name: 'Freefall',
    qi: 60,
    cooldown: 30,
    kind: 'damage',
    effects: [{ type: 'cut', share: 0.1, of: 'max', hits: 3 }],
    when: always,
  },
  'Heavenly Audit': {
    id: 'finalJudgement',
    name: 'Final Judgement',
    qi: 60,
    cooldown: 30,
    kind: 'damage',
    windUp: FINAL_JUDGEMENT_WIND_UP,
    effects: [{ type: 'hit', mult: 4 }],
    when: always,
  },
};

// Maps, so a name read from a save never reaches an object's prototype.
const ELITE_BY_DEMON: ReadonlyMap<string, SkillDef> = new Map(Object.entries(ELITES));
const BOSS_BY_NAME: ReadonlyMap<string, readonly SkillDef[]> = new Map(Object.entries(BOSS_SKILLS));
const TRIBULATION_BY_NAME: ReadonlyMap<string, readonly SkillDef[]> = new Map(
  // Lightning first: it wins a tie with a signature skill of the same cost.
  Object.entries(SIGNATURES).map(([name, def]) => [name, [LIGHTNING, def]]),
);

const ELITE_PREFIX = 'Elite ';

/**
 * The skills `enemy` may cast, in priority order for ties; `uses` counts its
 * casts this fight by skill id. Regular demons have none.
 */
export function enemySkills(
  enemy: Pick<Enemy, 'kind' | 'name'>,
  uses: Readonly<Record<string, number>>,
): readonly SkillDef[] {
  if (enemy.kind === 'boss') return BOSS_BY_NAME.get(enemy.name) ?? [];
  if (enemy.kind === 'tribulation') return TRIBULATION_BY_NAME.get(enemy.name) ?? [];
  if (enemy.kind !== 'elite' || !enemy.name.startsWith(ELITE_PREFIX)) return [];
  const demon = enemy.name.slice(ELITE_PREFIX.length);
  if (demon === 'Reply-All Swarm') {
    return [replyAll(Object.hasOwn(uses, 'replyAll') ? (uses.replyAll as number) : 0)];
  }
  const def = ELITE_BY_DEMON.get(demon);
  return def ? [def] : [];
}

/** Every elite, boss and Tribulation skill's name, for the language packs. */
export const ENEMY_SKILL_NAMES: readonly string[] = [
  ...Object.values(ELITES).map((d) => d.name),
  replyAll(0).name,
  ...Object.values(BOSS_SKILLS).flatMap((list) => list.map((d) => d.name)),
  ...Object.values(SIGNATURES).map((d) => d.name),
  LIGHTNING.name,
];
