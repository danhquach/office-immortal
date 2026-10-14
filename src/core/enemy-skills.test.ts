import { describe, expect, it } from 'vitest';
import { derive } from './cultivator.ts';
import {
  ENEMY_SKILL_NAMES,
  enemySkills,
  EXPENSE_MIN_QI,
  FINAL_JUDGEMENT_WIND_UP,
  LIGHTNING_HP_SHARE,
  LIGHTNING_WIND_UP,
  MICROMANAGE_QI_SHARE,
  SEIZURE_MIN_QI,
} from './enemy-skills.ts';
import {
  BOSSES,
  DEMONS,
  makeEnemy,
  makeFloor,
  makeTribulation,
  maxQi,
  TRIBULATIONS,
  type EnemyKind,
} from './floors.ts';
import { createRng } from './rng.ts';
import {
  freshStatus,
  usable,
  WIND_UP,
  type CastNote,
  type FighterView,
  type RuleInputs,
  type SkillContext,
  type SkillDef,
} from './skills.ts';
import { gameSkills, mitigate, newGame, tick, type GameState, type Loadout } from './sim.ts';

const OFF = 1e15;

/** The skills a named elite, boss or Tribulation has, by id. */
const OWN: readonly (readonly [EnemyKind, string, readonly string[]])[] = [
  ['elite', 'Elite Deadline Fiend', ['crunchTime']],
  ['elite', 'Elite Inbox Hydra', ['unreadFlood']],
  ['elite', 'Elite Meeting Wraith', ['couldBeEmail']],
  ['elite', 'Elite Printer Golem', ['paperJam']],
  ['elite', 'Elite Reply-All Swarm', ['replyAll']],
  ['boss', 'Quarterly Review', ['missedTargets', 'pip']],
  ['boss', 'The Auditor', ['expenseDisallowed', 'fullAudit']],
  ['boss', 'Middle Manager', ['delegation', 'micromanage']],
  ['tribulation', 'Probation Review', ['heavenlyLightning', 'finalWarning']],
  ['tribulation', 'Annual Appraisal', ['heavenlyLightning', 'bellCurve']],
  ['tribulation', 'Restructuring', ['heavenlyLightning', 'redundancy']],
  ['tribulation', 'Hostile Takeover', ['heavenlyLightning', 'assetSeizure']],
  ['tribulation', 'Shareholder Revolt', ['heavenlyLightning', 'noConfidence']],
  ['tribulation', 'Board Inquiry', ['heavenlyLightning', 'underInvestigation']],
  ['tribulation', 'Regulatory Probe', ['heavenlyLightning', 'complianceFreeze']],
  ['tribulation', 'Market Crash', ['heavenlyLightning', 'freefall']],
  ['tribulation', 'Heavenly Audit', ['heavenlyLightning', 'finalJudgement']],
];

/** The skill `id` of the enemy `name`. */
function skill(kind: EnemyKind, name: string, id: string, uses: Record<string, number> = {}) {
  const def = enemySkills({ kind, name }, uses).find((k) => k.id === id);
  if (!def) throw new Error(`${name} has no ${id}`);
  return def;
}

describe('who has which skills', () => {
  it.each(OWN)('a %s %s casts only its own', (kind, name, ids) => {
    expect(enemySkills({ kind, name }, {}).map((k) => k.id)).toEqual(ids);
  });

  it('gives regular demons none, and a Tribulation only by its own name', () => {
    for (const name of [...DEMONS, ...BOSSES, ...TRIBULATIONS]) {
      expect(enemySkills({ kind: 'demon', name }, {})).toEqual([]);
    }
    for (const name of [...DEMONS, ...BOSSES]) {
      expect(enemySkills({ kind: 'tribulation', name }, {})).toEqual([]);
    }
    // A Tribulation's name on a boss or elite gives nothing either.
    expect(enemySkills({ kind: 'boss', name: 'Heavenly Audit' }, {})).toEqual([]);
    expect(enemySkills({ kind: 'elite', name: 'Elite Heavenly Audit' }, {})).toEqual([]);
  });

  it('gives an unknown or hostile name none, never a prototype entry', () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'Elite __proto__', 'Elite ', '']) {
      expect(enemySkills({ kind: 'elite', name }, {})).toEqual([]);
      expect(enemySkills({ kind: 'boss', name }, {})).toEqual([]);
      expect(enemySkills({ kind: 'tribulation', name }, {})).toEqual([]);
    }
    // An elite's skill comes from its "Elite " name only.
    expect(enemySkills({ kind: 'elite', name: 'Printer Golem' }, {})).toEqual([]);
    expect(enemySkills({ kind: 'boss', name: 'Elite Printer Golem' }, {})).toEqual([]);
    // Near misses of a real name: zero-width, bidi, padding, look-alikes, case, size.
    for (const name of [
      'Elite Printer\u200bGolem',
      'Elite \u202ePrinter Golem',
      'Elite Printer Golem ',
      'Elite  Printer Golem',
      'Elite Pr\u0456nter Golem',
      'elite Printer Golem',
      'Elite ' + 'x'.repeat(100_000),
      'Quarterly Review\u200b',
      'Heavenly Audit\u200b',
      'Heavenly\u00a0Audit',
      'heavenly audit',
    ]) {
      expect(enemySkills({ kind: 'elite', name }, {})).toEqual([]);
      expect(enemySkills({ kind: 'boss', name }, {})).toEqual([]);
      expect(enemySkills({ kind: 'tribulation', name }, {})).toEqual([]);
    }
  });

  it('reads only its own cast counts, never inherited ones', () => {
    const hits = (uses: Record<string, number>) =>
      enemySkills({ kind: 'elite', name: 'Elite Reply-All Swarm' }, uses)[0]?.effects;
    const five = [{ type: 'hit', mult: 0.3, hits: 5 }];
    expect(hits(Object.create({ replyAll: 999 }) as Record<string, number>)).toEqual(five);
    expect(hits(JSON.parse('{"__proto__":{"replyAll":999}}') as Record<string, number>)).toEqual(
      five,
    );
  });

  it('covers every Tribulation the game makes', () => {
    TRIBULATIONS.forEach((name, realm) => {
      expect(enemySkills(makeTribulation(1 + realm * 10, realm), {}), name).toHaveLength(2);
    });
  });

  it('covers every demon and boss on a real floor', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const e of makeFloor(createRng(seed), 1 + (seed % 30))) {
        const n = enemySkills(e, {}).length;
        expect(n, e.name).toBe(e.kind === 'elite' ? 1 : e.kind === 'boss' ? 2 : 0);
      }
    }
  });

  it('names all twenty-one, once each, for the language packs', () => {
    expect(ENEMY_SKILL_NAMES).toHaveLength(21);
    expect(new Set(ENEMY_SKILL_NAMES).size).toBe(21);
    const all = OWN.flatMap(([kind, name, ids]) => ids.map((id) => skill(kind, name, id).name));
    expect([...ENEMY_SKILL_NAMES].sort()).toEqual([...new Set(all)].sort());
  });

  it('costs qi its caster can hold, and every one winds up', () => {
    for (const [kind, name, ids] of OWN) {
      for (const id of ids) {
        const def = skill(kind, name, id);
        expect(def.qi).toBeGreaterThan(0);
        expect(def.qi).toBeLessThanOrEqual(Math.min(100, maxQi(kind)));
        expect(def.windUp ?? WIND_UP).toBeGreaterThan(0);
      }
    }
  });

  it('the game casts them for the enemy in front', () => {
    const s = newGame(5, 'sword');
    expect(gameSkills(s, 'foe')).toEqual([]);
    s.enemies = [makeEnemy(1, 'boss', 'The Auditor')];
    expect(gameSkills(s, 'foe').map((k) => k.id)).toEqual(['expenseDisallowed', 'fullAudit']);
  });
});

describe('enemy skills in a fight', () => {
  /**
   * A sword cultivator with no stats beyond its base, full HP and qi, before
   * enemy `name` with qi `qi` and 1e6 HP, past the arrival pause. Nobody
   * attacks: the regen step, once a second, is the event the cast follows.
   */
  function arena(kind: EnemyKind, name: string, qi: number, seed = 3): GameState {
    const s = newGame(seed, 'sword');
    const c = s.cultivator;
    c.stats.agility = 0;
    c.stats.spirit = 0;
    c.stats.body = 0;
    const foe = makeEnemy(1, kind, name);
    foe.maxHp = foe.hp = 1e6;
    foe.qi = qi;
    s.enemies = [foe];
    const d = derive(c);
    c.hp = d.maxHp;
    c.qi = d.maxQi;
    c.nextAttackAt = OFF;
    s.enemyNextAttackAt = OFF;
    s.combat.fightAt = s.time;
    return s;
  }

  /** The enemy's skills only; the cultivator casts none. */
  const foeOnly: Loadout = (s, side) => (side === 'foe' ? gameSkills(s, 'foe') : []);

  /**
   * Plays until the `nth` landing of `name` and gives the state at that
   * instant, checking it landed `windUp` after its wind-up began.
   */
  function landing(s: GameState, name: string, windUp = WIND_UP, nth = 1, horizon = 60) {
    const log = tick(s, horizon, { loadout: foeOnly }).combat.log.filter(
      (n): n is CastNote & { skill: string; windUp: boolean } =>
        'skill' in n && n.who === 'foe' && n.skill === name,
    );
    const starts = log.filter((n) => n.windUp);
    const lands = log.filter((n) => !n.windUp);
    const start = starts[nth - 1];
    const land = lands[nth - 1];
    if (!start || !land) throw new Error(`${name} did not land ${nth} time(s)`);
    expect(land.at - start.at).toBeCloseTo(windUp, 9);
    const after = tick(s, land.at - s.time, { loadout: foeOnly });
    return { after, at: land.at, d: derive(s.cultivator), foe: s.enemies[0]! };
  }

  it('Deadline Frenzy Art: +50% attack speed for 5 s, after a 1 s wind-up', () => {
    const { after, at } = landing(
      arena('elite', 'Elite Deadline Fiend', 60),
      'Deadline Frenzy Art',
    );
    expect(after.combat.foe.mods).toEqual([
      { stat: 'attackSpeed', amount: 0.5, until: at + 5, source: 'crunchTime' },
    ]);
  });

  it('Ten Thousand Unread Scrolls: 3 hits at 60%', () => {
    const { after, d, foe } = landing(
      arena('elite', 'Elite Inbox Hydra', 60),
      'Ten Thousand Unread Scrolls',
    );
    expect(after.cultivator.hp).toBe(d.maxHp - 3 * mitigate(foe.damage * 0.6, d.defence));
  });

  it('Endless Meeting Domain: the player attacks 30% slower for 5 s', () => {
    const s = arena('elite', 'Elite Meeting Wraith', 60);
    const { after, at } = landing(s, 'Endless Meeting Domain');
    expect(after.combat.you.mods).toEqual([
      { stat: 'attackSpeed', amount: -0.3, until: at + 5, source: 'couldBeEmail' },
    ]);
  });

  it('Paper-Binding Seal: stuns the player for 1.5 s', () => {
    const { after, at } = landing(arena('elite', 'Elite Printer Golem', 60), 'Paper-Binding Seal');
    expect(after.combat.you.stunUntil).toBe(at + 1.5);
    expect(after.combat.log.at(-1)).toMatchObject({ at, who: 'you', effect: 'stunned' });
  });

  it('Thousand Echo Reply Array: 5 hits at 30%, then one more each cast that fight', () => {
    const s = arena('elite', 'Elite Reply-All Swarm', 60);
    const { d, foe } = landing(s, 'Thousand Echo Reply Array');
    const hit = mitigate(foe.damage * 0.3, d.defence);
    // Between casts the cultivator's HP regen is off (no Body), so HP only falls to the hits.
    const one = landing(s, 'Thousand Echo Reply Array', WIND_UP, 1).after;
    expect(one.cultivator.hp).toBe(d.maxHp - 5 * hit);
    const two = landing(s, 'Thousand Echo Reply Array', WIND_UP, 2).after;
    expect(two.combat.foe.uses.replyAll).toBe(2);
    expect(two.cultivator.hp).toBe(d.maxHp - (5 + 6) * hit);
    // The count is the fight's (fresh each fight): no casts yet is 5 hits again.
    expect(skill('elite', 'Elite Reply-All Swarm', 'replyAll').effects).toEqual([
      { type: 'hit', mult: 0.3, hits: 5 },
    ]);
    expect(skill('elite', 'Elite Reply-All Swarm', 'replyAll', { replyAll: 3 }).effects).toEqual([
      { type: 'hit', mult: 0.3, hits: 7 },
    ]);
  });

  it('Quarterly Judgement Palm: one hit at 250% after a 2.5 s wind-up', () => {
    const s = arena('boss', 'Quarterly Review', 100);
    const { after, d, foe } = landing(s, 'Quarterly Judgement Palm', 2.5);
    expect(after.cultivator.hp).toBe(d.maxHp - mitigate(foe.damage * 2.5, d.defence));
  });

  it('Meridian-Sealing Review: player damage −25% for 6 s', () => {
    // Only enough qi for the cheaper of the two.
    const s = arena('boss', 'Quarterly Review', 40);
    const { after, at } = landing(s, 'Meridian-Sealing Review');
    expect(after.combat.you.mods).toEqual([
      { stat: 'damage', amount: -0.25, until: at + 6, source: 'pip' },
    ]);
  });

  it('Qi Confiscation Palm: takes 50 of the player qi, then hits at 100%', () => {
    const { after, d, foe } = landing(arena('boss', 'The Auditor', 50), 'Qi Confiscation Palm');
    expect(after.cultivator.qi).toBe(d.maxQi - 50);
    expect(after.cultivator.hp).toBe(d.maxHp - mitigate(foe.damage, d.defence));
  });

  it('Golden Ledger Body: the boss takes 50% less damage for 5 s', () => {
    const s = arena('boss', 'The Auditor', 40);
    s.enemies[0]!.hp = 5e5;
    const { after, at } = landing(s, 'Golden Ledger Body');
    expect(after.combat.foe.mods).toEqual([
      { stat: 'damageTaken', amount: -0.5, until: at + 5, source: 'fullAudit' },
    ]);
  });

  it('Burden-Shifting Mirror: reflects 30% of damage for 5 s', () => {
    const { after, at } = landing(arena('boss', 'Middle Manager', 40), 'Burden-Shifting Mirror');
    expect(after.combat.foe.reflect).toBe(0.3);
    expect(after.combat.foe.reflectUntil).toBe(at + 5);
  });

  it('Heavenly Oversight Seal: blocks the player skills for 4 s', () => {
    const { after, at } = landing(arena('boss', 'Middle Manager', 100), 'Heavenly Oversight Seal');
    expect(after.combat.you.silenceUntil).toBe(at + 4);
  });

  /** A Tribulation, qi `qi`, at full HP unless `hpShare` (of its max) says otherwise. */
  function trial(name: string, qi: number, hpShare = 1): GameState {
    const s = arena('tribulation', name, qi);
    s.enemies[0]!.hp = 1e6 * hpShare;
    return s;
  }

  it('Final Warning: 100% at full HP, more the lower the player HP', () => {
    const full = landing(trial('Probation Review', 30), 'Final Warning');
    expect(full.after.cultivator.hp).toBe(full.d.maxHp - mitigate(full.foe.damage, full.d.defence));
    const s = trial('Probation Review', 30);
    const hp = Math.round(full.d.maxHp * 0.6);
    s.cultivator.hp = hp;
    const low = landing(s, 'Final Warning');
    expect(low.after.cultivator.hp).toBe(
      hp - mitigate(low.foe.damage * (1 + (1 - hp / low.d.maxHp)), low.d.defence),
    );
  });

  it('Bell Curve: damage equal to 20% of the player current HP, past defence', () => {
    const s = trial('Annual Appraisal', 30);
    const { after, d } = landing(s, 'Bell Curve');
    expect(after.cultivator.hp).toBe(d.maxHp - Math.round(d.maxHp * 0.2));
    s.cultivator.hp = 50;
    expect(landing(s, 'Bell Curve').after.cultivator.hp).toBe(40);
  });

  it('Redundancy: removes the player active buffs, not its debuffs', () => {
    const s = trial('Restructuring', 40);
    const you = s.combat.you;
    you.mods = [
      { stat: 'attackSpeed', amount: 0.4, until: OFF, source: 'lightningStep' },
      { stat: 'damage', amount: -0.25, until: OFF, source: 'pip' },
    ];
    you.shield = 30;
    you.shieldUntil = OFF;
    you.reflect = 0.2;
    you.reflectUntil = OFF;
    const { after, at } = landing(s, 'Redundancy');
    expect(after.combat.you.mods.map((m) => m.source)).toEqual(['pip']);
    expect(after.combat.you).toMatchObject({ shield: 0, reflect: 0 });
    expect(after.combat.log.at(-1)).toMatchObject({ at, who: 'you', effect: 'dispelled' });
  });

  it('Asset Seizure: steals 40 of the player qi', () => {
    const { after, d } = landing(trial('Hostile Takeover', 30), 'Asset Seizure');
    expect(after.cultivator.qi).toBe(d.maxQi - 40);
    // 30 spent, a second of regen in the wind-up, 40 stolen.
    expect(after.enemies[0]?.qi).toBeGreaterThanOrEqual(40);
    expect(after.enemies[0]?.qi).toBeLessThanOrEqual(42);
  });

  it('Vote of No Confidence: blocks the player skills for 2 s', () => {
    const { after, at } = landing(trial('Shareholder Revolt', 40), 'Vote of No Confidence');
    expect(after.combat.you.silenceUntil).toBe(at + 2);
    expect(after.combat.log.at(-1)).toMatchObject({ at, who: 'you', effect: 'silenced' });
  });

  it('Under Investigation: burns for 100% over 5 s', () => {
    const s = trial('Board Inquiry', 40);
    const { after, at, d, foe } = landing(s, 'Under Investigation');
    expect(after.combat.you.burns).toEqual([{ damage: foe.damage / 5, left: 5, next: at + 1 }]);
    // Five ticks through defence, then no more.
    const later = tick(after, 6, { loadout: () => [] });
    expect(later.combat.you.burns).toEqual([]);
    expect(later.cultivator.hp).toBe(d.maxHp - 5 * mitigate(foe.damage / 5, d.defence));
  });

  it('Compliance Freeze: stuns the player for 1.5 s', () => {
    const { after, at } = landing(trial('Regulatory Probe', 40), 'Compliance Freeze');
    expect(after.combat.you.stunUntil).toBe(at + 1.5);
  });

  it('Freefall: 3 hits, each 10% of the player max HP', () => {
    const { after, d } = landing(trial('Market Crash', 60), 'Freefall');
    expect(after.cultivator.hp).toBe(d.maxHp - 3 * Math.round(d.maxHp * 0.1));
  });

  it(`Final Judgement: a 400% strike after a ${FINAL_JUDGEMENT_WIND_UP} s wind-up`, () => {
    const s = trial('Heavenly Audit', 60);
    const { after, d, foe } = landing(s, 'Final Judgement', FINAL_JUDGEMENT_WIND_UP);
    expect(FINAL_JUDGEMENT_WIND_UP).toBeGreaterThan(WIND_UP);
    expect(after.cultivator.hp).toBe(d.maxHp - mitigate(foe.damage * 4, d.defence));
  });

  it.each(TRIBULATIONS)(
    '%s gains Heavenly Lightning below half HP: 3 telegraphed strikes, each 10% of max HP',
    (name) => {
      // Qi for Lightning only, or a tie with a 30 qi signature: Lightning is listed first.
      const s = trial(name, 30, LIGHTNING_HP_SHARE - 0.01);
      // A short horizon, so later casts never push the first out of the log.
      const third = landing(s, 'Heavenly Lightning', LIGHTNING_WIND_UP, 3, 12);
      // Past defence: the same share of HP on every Path.
      const strike = Math.round(third.d.maxHp * 0.1);
      const first = landing(s, 'Heavenly Lightning', LIGHTNING_WIND_UP, 1, 12);
      expect(first.after.cultivator.hp).toBe(first.d.maxHp - strike);
      expect(third.after.cultivator.hp).toBe(third.d.maxHp - 3 * strike);
      // One cast: the qi is paid once.
      expect(third.after.combat.foe.uses.heavenlyLightning).toBe(1);
    },
  );

  it.each(TRIBULATIONS)(
    '%s casts Heavenly Lightning in a real fight below half HP, its signature skill too',
    (name) => {
      // From 0 qi, attacking as normal: a cheap signature must not keep its
      // qi from ever reaching Lightning.
      const s = trial(name, 0, LIGHTNING_HP_SHARE - 0.01);
      s.enemyNextAttackAt = s.time + 2;
      // The player's buff, so Redundancy has one to end.
      s.combat.you.mods.push({ stat: 'damage', amount: 0.1, until: OFF, source: 'test' });
      // Healed every second, so it never falls and the fight (and its counts) goes on.
      let after = s;
      for (let i = 0; i < 90; i++) {
        after = tick(after, 1, { loadout: foeOnly });
        after.cultivator.hp = derive(after.cultivator).maxHp;
      }
      expect(after.deaths).toBe(s.deaths);
      const uses = after.combat.foe.uses;
      expect(uses.heavenlyLightning, name).toBeGreaterThanOrEqual(2);
      const own = enemySkills({ kind: 'tribulation', name }, {})[1]!.id;
      expect(uses[own], name).toBeGreaterThanOrEqual(1);
    },
  );

  it('casts no Heavenly Lightning at half HP or more', () => {
    for (const name of TRIBULATIONS) {
      const s = trial(name, 150, LIGHTNING_HP_SHARE);
      const log = tick(s, 60, { loadout: foeOnly }).combat.log;
      expect(
        log.some((n) => 'skill' in n && n.skill === 'Heavenly Lightning'),
        name,
      ).toBe(false);
    }
  });

  it('a stun answers the wind-up: it is cancelled and the qi stays spent', () => {
    const s = arena('boss', 'Quarterly Review', 100);
    // A cultivator that stuns whenever the enemy winds up.
    const stun: SkillDef = {
      id: 'stun',
      name: 'Stun',
      qi: 1,
      cooldown: 100,
      kind: 'other',
      effects: [{ type: 'stun', duration: 3 }],
      when: (ctx) => ctx.other.windingUp,
    };
    const both: Loadout = (x, side) => (side === 'foe' ? gameSkills(x, 'foe') : [stun]);
    const after = tick(s, 4.5, { loadout: both });
    const foe = after.combat.log.filter((n) => n.who === 'foe');
    expect(
      foe.some((n) => 'skill' in n && n.windUp && n.skill === 'Quarterly Judgement Palm'),
    ).toBe(true);
    expect(foe.some((n) => 'skill' in n && !n.windUp)).toBe(false);
    expect(foe.some((n) => 'effect' in n && n.effect === 'interrupted')).toBe(true);
    expect(after.cultivator.hp).toBe(derive(after.cultivator).maxHp);
    // 60 spent, a few seconds of regen back.
    expect(after.enemies[0]?.qi).toBeLessThan(50);
  });
});

describe('enemy skill "uses it when" rules', () => {
  function view(over: Partial<FighterView> = {}): FighterView {
    return {
      hp: 100,
      maxHp: 100,
      qi: 100,
      maxQi: 100,
      windingUp: false,
      fightTime: 5,
      burning: false,
      evades: 0,
      buffs: 0,
      ...over,
    };
  }

  function inputs(
    over: { self?: Partial<FighterView>; other?: Partial<FighterView> } & Partial<
      Omit<SkillContext, 'self' | 'other'>
    > & { status?: ReturnType<typeof freshStatus>; nextHitKills?: boolean } = {},
  ): RuleInputs {
    const { self, other, status, nextHitKills, ...ctx } = over;
    return {
      ctx: {
        side: 'foe',
        self: view(self),
        other: view(other),
        foeKind: 'boss',
        waveLeft: 1,
        reachable: 1,
        incoming: 10,
        ...ctx,
      },
      status: status ?? freshStatus(),
      now: 10,
      nextHitKills: nextHitKills ?? false,
    };
  }

  const may = (def: SkillDef, over: Parameters<typeof inputs>[0] = {}) =>
    usable(def, [def], inputs(over));

  /** A status with `id` on cooldown until `until`. */
  const cooling = (id: string, until: number) => ({
    ...freshStatus(),
    cooldowns: { [id]: until },
  });

  it('every one needs its qi', () => {
    for (const [kind, name, ids] of OWN) {
      for (const id of ids) {
        const def = skill(kind, name, id);
        expect(may(def, { self: { qi: def.qi - 1 }, other: { hp: 10, qi: 100 } }), id).toBe(false);
      }
    }
  });

  it('Deadline Frenzy Art: whenever ready, not again while the buff runs', () => {
    const def = skill('elite', 'Elite Deadline Fiend', 'crunchTime');
    expect(may(def)).toBe(true);
    const status = freshStatus();
    status.mods.push({ stat: 'attackSpeed', amount: 0.5, until: 12, source: 'crunchTime' });
    expect(may(def, { status })).toBe(false);
    status.mods[0]!.until = 10;
    expect(may(def, { status })).toBe(true);
  });

  it.each([
    ['elite', 'Elite Inbox Hydra', 'unreadFlood'],
    ['elite', 'Elite Reply-All Swarm', 'replyAll'],
    ['boss', 'Quarterly Review', 'missedTargets'],
  ] as const)('%s %s: whenever ready, but not when the next normal hit kills', (k, name, id) => {
    const def = skill(k, name, id);
    expect(may(def)).toBe(true);
    expect(may(def, { nextHitKills: true })).toBe(false);
  });

  it.each([
    ['elite', 'Elite Meeting Wraith', 'couldBeEmail', 5],
    ['elite', 'Elite Printer Golem', 'paperJam', 1.5],
    ['boss', 'Quarterly Review', 'pip', 6],
  ] as const)(
    '%s %s: whenever ready, its cooldown outlasting the effect (%d s)',
    (k, name, id, lasts) => {
      const def = skill(k, name, id);
      expect(def.cooldown).toBeGreaterThan(lasts);
      expect(may(def)).toBe(true);
      expect(may(def, { status: cooling(id, 11) })).toBe(false);
      expect(may(def, { status: cooling(id, 10) })).toBe(true);
    },
  );

  it(`Qi Confiscation Palm: the player holds ${EXPENSE_MIN_QI} qi or more`, () => {
    const def = skill('boss', 'The Auditor', 'expenseDisallowed');
    expect(may(def, { other: { qi: EXPENSE_MIN_QI } })).toBe(true);
    expect(may(def, { other: { qi: EXPENSE_MIN_QI - 1 } })).toBe(false);
  });

  it('Golden Ledger Body: HP at or below 60% (defensive), not again while it runs', () => {
    const def = skill('boss', 'The Auditor', 'fullAudit');
    expect(def.kind).toBe('defensive');
    expect(may(def, { self: { hp: 61 } })).toBe(false);
    expect(may(def, { self: { hp: 60 } })).toBe(true);
    const status = freshStatus();
    status.mods.push({ stat: 'damageTaken', amount: -0.5, until: 12, source: 'fullAudit' });
    expect(may(def, { self: { hp: 30 }, status })).toBe(false);
    expect(may(def, { self: { hp: 30 }, status: cooling('fullAudit', 11) })).toBe(false);
  });

  it('Burden-Shifting Mirror: whenever ready, not again while the reflect runs', () => {
    const def = skill('boss', 'Middle Manager', 'delegation');
    expect(may(def)).toBe(true);
    const status = freshStatus();
    status.reflect = 0.3;
    status.reflectUntil = 12;
    expect(may(def, { status })).toBe(false);
  });

  it("Heavenly Oversight Seal: the player's qi nearly full (90% of its max or more)", () => {
    const def = skill('boss', 'Middle Manager', 'micromanage');
    expect(MICROMANAGE_QI_SHARE).toBe(0.9);
    expect(may(def, { other: { qi: 180, maxQi: 200 } })).toBe(true);
    expect(may(def, { other: { qi: 179, maxQi: 200 } })).toBe(false);
    expect(may(def, { other: { qi: 180, maxQi: 200 }, status: cooling('micromanage', 11) })).toBe(
      false,
    );
  });

  it('Heavenly Lightning: only below half its max HP, not when the next normal hit kills', () => {
    const def = skill('tribulation', 'Market Crash', 'heavenlyLightning');
    expect(def.strikes).toBe(3);
    expect(may(def, { self: { hp: 50 } })).toBe(false);
    expect(may(def, { self: { hp: 49 } })).toBe(true);
    expect(may(def, { self: { hp: 49 }, nextHitKills: true })).toBe(false);
  });

  it.each([
    ['Probation Review', 'finalWarning'],
    ['Annual Appraisal', 'bellCurve'],
    ['Board Inquiry', 'underInvestigation'],
    ['Market Crash', 'freefall'],
    ['Heavenly Audit', 'finalJudgement'],
  ] as const)('%s %s: whenever ready, but not when the next normal hit kills', (name, id) => {
    const def = skill('tribulation', name, id);
    expect(def.kind).toBe('damage');
    expect(may(def)).toBe(true);
    expect(may(def, { nextHitKills: true })).toBe(false);
  });

  it.each([
    ['Shareholder Revolt', 'noConfidence', 5],
    ['Board Inquiry', 'underInvestigation', 8],
    ['Regulatory Probe', 'complianceFreeze', 2],
  ] as const)('%s %s: its cooldown outlasts the effect (%d s)', (name, id, lasts) => {
    const def = skill('tribulation', name, id);
    expect(def.cooldown).toBeGreaterThan(lasts);
    expect(may(def, { status: cooling(id, 11) })).toBe(false);
  });

  it('Redundancy: only while the player has a buff', () => {
    const def = skill('tribulation', 'Restructuring', 'redundancy');
    expect(may(def)).toBe(false);
    expect(may(def, { other: { buffs: 1 } })).toBe(true);
  });

  it(`Asset Seizure: the player holds ${SEIZURE_MIN_QI} qi or more`, () => {
    const def = skill('tribulation', 'Hostile Takeover', 'assetSeizure');
    expect(may(def, { other: { qi: SEIZURE_MIN_QI } })).toBe(true);
    expect(may(def, { other: { qi: SEIZURE_MIN_QI - 1 } })).toBe(false);
  });

  it('a boss casts the costliest it may: Heavenly Oversight Seal over Burden-Shifting Mirror, when both may', () => {
    const list = enemySkills({ kind: 'boss', name: 'Middle Manager' }, {});
    const r = inputs({ other: { qi: 100 } });
    expect(list.filter((d) => usable(d, list, r)).map((d) => d.id)).toEqual([
      'delegation',
      'micromanage',
    ]);
  });
});
