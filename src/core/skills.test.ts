import { describe, expect, it } from 'vitest';
import { derive, effectiveStats } from './cultivator.ts';
import { makeEnemy, makeTribulation, type EnemyKind } from './floors.ts';
import {
  bossOrTougher,
  buffed,
  BURN_TICK,
  CAST_PAUSE,
  chooseSkill,
  cooldownFor,
  DEFENSIVE_HP_SHARE,
  freshCombat,
  freshStatus,
  HOLD_WITHIN_QI,
  LOG_SIZE,
  MAX_BURNS,
  modInterval,
  note,
  SKILL_DAMAGE_PER_SPIRIT,
  usable,
  WIND_UP,
  type CastNote,
  type Effect,
  type FighterView,
  type RuleInputs,
  type SkillContext,
  type SkillDef,
} from './skills.ts';
import {
  canFaceTribulation,
  ENEMY_ARRIVAL,
  faceTribulation,
  mitigate,
  newGame,
  noSkills,
  tick,
  type GameState,
  type TickOptions,
} from './sim.ts';

const OFF = 1e15;

/** A test skill: 10 qi, no cooldown, cast whenever the shared rules allow. */
function skill(over: Partial<SkillDef> = {}): SkillDef {
  return {
    id: 'test',
    name: 'Test Skill',
    qi: 10,
    cooldown: 0,
    kind: 'other',
    effects: [],
    when: () => true,
    ...over,
  };
}

/** Tick options casting `you` for the cultivator and `foe` for the enemy in front. */
function book(you: SkillDef[], foe: SkillDef[] = []): TickOptions {
  return { loadout: (_s, side) => (side === 'you' ? you : foe) };
}

/**
 * A fight against one enemy of `kind`, already started, where only the events
 * turned on happen. Both sides have room to take hits; qi starts full.
 */
function arena(
  kind: EnemyKind = 'elite',
  on: { you?: boolean; foe?: boolean; regen?: boolean } = { regen: true },
  seed = 3,
): GameState {
  const s = newGame(seed, 'sword');
  const enemy = makeEnemy(1, kind, 'Test Demon');
  enemy.maxHp = enemy.hp = 1e6;
  enemy.qi = 60;
  s.enemies = [enemy, makeEnemy(1, 'demon', 'Waiting Demon')];
  // No Agility: no dodge rolls and no cooldown cut; no Spirit: skill hits at
  // their bare share. Unless a test sets them.
  s.cultivator.stats.agility = 0;
  s.cultivator.stats.spirit = 0;
  s.cultivator.hp = derive(s.cultivator).maxHp;
  s.cultivator.qi = derive(s.cultivator).maxQi;
  if (!on.you) s.cultivator.nextAttackAt = OFF;
  if (!on.foe) s.enemyNextAttackAt = OFF;
  if (!on.regen) s.qiNextAt = OFF;
  return s;
}

function front(s: GameState) {
  const e = s.enemies[0];
  if (!e) throw new Error('no enemy');
  return e;
}

/** The cast notes (not effects) in the log. */
function casts(s: GameState) {
  return s.combat.log.filter((n): n is Extract<CastNote, { skill: string }> => 'skill' in n);
}

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
    ...over,
  };
}

function inputs(
  over: { self?: Partial<FighterView>; other?: Partial<FighterView> } & Partial<
    Omit<SkillContext, 'self' | 'other'>
  > & { nextHitKills?: boolean } = {},
): RuleInputs {
  const { self, other, nextHitKills, ...ctx } = over;
  return {
    ctx: {
      side: 'you',
      self: view(self),
      other: view(other),
      foeKind: 'elite',
      waveLeft: 3,
      reachable: 3,
      incoming: 10,
      ...ctx,
    },
    status: freshStatus(),
    now: 10,
    nextHitKills: nextHitKills ?? false,
  };
}

describe('shared rules', () => {
  it('needs enough qi, an ended cooldown, and no stun or silence', () => {
    const def = skill({ qi: 30 });
    expect(usable(def, [def], inputs())).toBe(true);
    expect(usable(def, [def], inputs({ self: { qi: 29 } }))).toBe(false);
    const r = inputs();
    r.status.cooldowns.test = 10.5;
    expect(usable(def, [def], r)).toBe(false);
    r.status.cooldowns.test = 10;
    expect(usable(def, [def], r)).toBe(true);
    const stunned = inputs();
    stunned.status.stunUntil = 11;
    expect(usable(def, [def], stunned)).toBe(false);
    const silenced = inputs();
    silenced.status.silenceUntil = 11;
    expect(usable(def, [def], silenced)).toBe(false);
  });

  it("follows the skill's own rule on top", () => {
    const def = skill({ when: (ctx) => ctx.waveLeft >= 2 });
    expect(usable(def, [def], inputs({ waveLeft: 2 }))).toBe(true);
    expect(usable(def, [def], inputs({ waveLeft: 1 }))).toBe(false);
  });

  describe('1: holds a cheap skill while a bigger one is within 20 qi', () => {
    const cheap = skill({ id: 'cheap', qi: 30 });
    const big = skill({ id: 'big', qi: 90 });
    const both = [cheap, big];

    it('against an elite, a boss or a Tribulation', () => {
      for (const foeKind of ['elite', 'boss', 'tribulation'] as const) {
        expect(usable(cheap, both, inputs({ foeKind, self: { qi: 90 - HOLD_WITHIN_QI } }))).toBe(
          false,
        );
      }
    });

    it('not against a demon, nor when the bigger one is further off', () => {
      expect(usable(cheap, both, inputs({ foeKind: 'demon', self: { qi: 80 } }))).toBe(true);
      expect(usable(cheap, both, inputs({ self: { qi: 90 - HOLD_WITHIN_QI - 1 } }))).toBe(true);
    });

    it('not when the bigger one is on cooldown, or already affordable', () => {
      const r = inputs({ self: { qi: 80 } });
      r.status.cooldowns.big = 20;
      expect(usable(cheap, both, r)).toBe(true);
      expect(usable(cheap, both, inputs({ self: { qi: 95 } }))).toBe(true);
    });

    it("is the cultivator's rule only: an enemy never holds its own skills", () => {
      expect(usable(cheap, both, inputs({ side: 'foe', self: { qi: 80 } }))).toBe(true);
    });

    it('never holds a defensive skill', () => {
      const guard = skill({ id: 'guard', qi: 30, kind: 'defensive' });
      const low = inputs({ self: { qi: 80, hp: 10 } });
      expect(usable(guard, [guard, big], low)).toBe(true);
    });
  });

  it('2: keeps a damage skill off an enemy the next normal hit kills', () => {
    const strike = skill({ kind: 'damage' });
    const buff = skill({ kind: 'other' });
    expect(usable(strike, [strike], inputs({ nextHitKills: true }))).toBe(false);
    expect(usable(strike, [strike], inputs({ nextHitKills: false }))).toBe(true);
    expect(usable(buff, [buff], inputs({ nextHitKills: true }))).toBe(true);
  });

  it('3: holds a defensive skill for low HP or a wind-up', () => {
    const guard = skill({ kind: 'defensive' });
    const at = (hp: number, windingUp = false) =>
      usable(guard, [guard], inputs({ self: { hp }, other: { windingUp } }));
    expect(at(100)).toBe(false);
    expect(at(100 * DEFENSIVE_HP_SHARE + 1)).toBe(false);
    expect(at(100 * DEFENSIVE_HP_SHARE)).toBe(true);
    expect(at(100, true)).toBe(true);
  });

  it('picks the costliest usable skill, ties in loadout order', () => {
    const a = skill({ id: 'a', qi: 20 });
    const b = skill({ id: 'b', qi: 40 });
    const c = skill({ id: 'c', qi: 40 });
    const far = skill({ id: 'far', qi: 200 });
    expect(chooseSkill([a, b, c], inputs())?.id).toBe('b');
    expect(chooseSkill([a, far], inputs({ foeKind: 'demon' }))?.id).toBe('a');
    expect(chooseSkill([a], inputs({ self: { qi: 5 } }))).toBeNull();
  });

  it('cuts cooldowns by a share, never past 95%', () => {
    const def = skill({ cooldown: 10 });
    expect(cooldownFor(def, 0)).toBe(10);
    expect(cooldownFor(def, 0.25)).toBe(7.5);
    expect(cooldownFor(def, 2)).toBeCloseTo(0.5);
    expect(cooldownFor(def, -1)).toBe(10);
  });

  it('keeps only the latest callouts, each with its own id', () => {
    const combat = freshCombat();
    for (let i = 0; i < LOG_SIZE + 3; i++) note(combat, { at: 1, who: 'you', effect: 'stunned' });
    expect(combat.log).toHaveLength(LOG_SIZE);
    expect(combat.log.map((n) => n.id)).toEqual([...Array(LOG_SIZE).keys()].map((i) => i + 3));
  });
});

describe('casting', () => {
  it('casts after a seeded pause of 0 to 0.8 s from the event that chose it', () => {
    const pauses = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = arena('elite', { regen: true }, seed);
      // The first regen step, at 1 s, is the first event: the cast is chosen there.
      const after = tick(s, 2, book([skill({ qi: 10, cooldown: 100 })]));
      const [cast] = casts(after);
      expect(cast).toBeDefined();
      const pause = (cast?.at ?? 0) - 1;
      expect(pause).toBeGreaterThanOrEqual(0);
      expect(pause).toBeLessThan(CAST_PAUSE);
      pauses.add(pause);
    }
    expect(pauses.size).toBeGreaterThan(30);
  });

  it('spends the qi and starts the cooldown as it casts', () => {
    const s = arena();
    const def = skill({ qi: 25, cooldown: 4 });
    const after = tick(s, 2, book([def]));
    const [cast] = casts(after);
    // Qi starts full, so the regen step at 1 s adds nothing; the one at 2 s does.
    const d = derive(s.cultivator);
    expect(after.cultivator.qi).toBe(d.maxQi - 25 + d.qiRegen);
    expect(after.combat.you.cooldowns.test).toBe((cast?.at ?? 0) + 4);
    expect(after.combat.you.uses.test).toBe(1);
  });

  it("cuts the cultivator's cooldown by Agility's cooldown reduction", () => {
    const s = arena();
    s.cultivator.stats.agility = 300;
    const cut = derive(s.cultivator).cooldownReduction;
    expect(cut).toBeGreaterThan(0.1);
    const after = tick(s, 2, book([skill({ cooldown: 10 })]));
    const [cast] = casts(after);
    expect(after.combat.you.cooldowns.test).toBeCloseTo((cast?.at ?? 0) + 10 * (1 - cut));
  });

  it("runs an enemy's cooldown in full", () => {
    const after = tick(arena(), 1.9, book([], [skill({ qi: 30, cooldown: 10 })]));
    const w = after.combat.foe.windUp;
    expect(after.combat.foe.cooldowns.test).toBeCloseTo((w?.start ?? 0) + 10);
  });

  it('drops a chosen cast whose rule no longer holds when the pause ends', () => {
    // Allowed only at the event that chose it, never after.
    let chosenAt = -1;
    const def = skill({
      when: () => {
        if (chosenAt < 0) chosenAt = 0;
        else return false;
        return true;
      },
    });
    const after = tick(arena(), 3, book([def]));
    expect(casts(after)).toHaveLength(0);
    expect(after.combat.you.pending).toBeNull();
  });

  it('casts nothing in the pause before a fight', () => {
    // The kill that ends this fight starts the next one ENEMY_ARRIVAL later.
    const s = arena('demon', { you: true, regen: true });
    front(s).hp = 1;
    const after = tick(s, 1.5, book([skill()]));
    expect(after.kills).toBe(1);
    const start = after.combat.fightAt;
    expect(start).toBeCloseTo(s.cultivator.nextAttackAt + ENEMY_ARRIVAL);
    expect(casts(after).every((n) => n.at >= start)).toBe(true);
  });

  it('draws no randomness for a side with no skills', () => {
    const s = arena();
    const none = tick(s, 30, { loadout: noSkills });
    expect(tick(s, 30, book([])).rng).toEqual(none.rng);
    expect(tick(s, 30, book([]))).toEqual(none);
  });

  it("counts the cultivator's pierce when a damage skill holds for a killing hit", () => {
    const s = arena();
    s.cultivator.stats.spirit = 300;
    s.cultivator.stats.agility = 300;
    const d = derive(s.cultivator);
    expect(d.pierce).toBeGreaterThan(0.1);
    front(s).defence = 200;
    // The normal hit kills only with its pierce.
    front(s).hp = mitigate(d.damage, 200, d.pierce);
    expect(mitigate(d.damage, 200)).toBeLessThan(front(s).hp);
    const strike = skill({ kind: 'damage', effects: [{ type: 'hit', mult: 3 }] });
    expect(casts(tick(s, 2, book([strike])))).toEqual([]);
  });

  it('rejects a skill with neither a qi cost nor a cooldown', () => {
    expect(() => tick(arena(), 2, book([skill({ qi: 0, cooldown: 0 })]))).toThrow(RangeError);
  });

  it('rejects a wind-up that is negative or not a number', () => {
    for (const windUp of [-1, NaN, Infinity]) {
      expect(() => tick(arena(), 2, book([], [skill({ windUp })]))).toThrow(RangeError);
    }
  });

  it('drops ended buffs as new ones come, so recasts never pile up', () => {
    const def = skill({
      qi: 1,
      effects: [{ type: 'mod', stat: 'damage', amount: 0.1, duration: 0.5, on: 'self' }],
    });
    const after = tick(arena(), 60, book([def]));
    expect(casts(after).length).toBeGreaterThan(0);
    expect(after.combat.you.uses.test).toBeGreaterThan(20);
    expect(after.combat.you.mods.length).toBeLessThan(10);
  });

  describe('determinism', () => {
    /** A busy real fight: both sides cast often, over many enemies and floors. */
    const opts = book(
      [
        skill({ id: 'strike', qi: 20, kind: 'damage', effects: [{ type: 'hit', mult: 2 }] }),
        skill({
          id: 'haste',
          qi: 30,
          cooldown: 6,
          effects: [{ type: 'mod', stat: 'attackSpeed', amount: 0.5, duration: 3, on: 'self' }],
        }),
        skill({
          id: 'guard',
          qi: 15,
          kind: 'defensive',
          effects: [{ type: 'shield', share: 0.2, duration: 4 }],
        }),
      ],
      [
        skill({ id: 'slam', qi: 20, kind: 'damage', effects: [{ type: 'hit', mult: 1.5 }] }),
        skill({ id: 'daze', qi: 30, cooldown: 5, effects: [{ type: 'stun', duration: 0.5 }] }),
      ],
    );

    it('replays the same from the same seed, and casts', () => {
      const a = tick(newGame(11, 'body'), 900, opts);
      const b = tick(newGame(11, 'body'), 900, opts);
      expect(a).toEqual(b);
      expect(casts(a).length).toBeGreaterThan(0);
    });

    it('plays the same in one big step as in many small ones, live and offline', () => {
      for (const offline of [false, true]) {
        const o = { ...opts, offline };
        let small = newGame(5, 'talisman');
        for (let i = 0; i < 600 / 0.37; i++) small = tick(small, 0.37, o);
        const big = tick(newGame(5, 'talisman'), small.time, o);
        expect(big).toEqual(small);
      }
    });
  });
});

describe('enemy wind-up', () => {
  const slam = (over: Partial<SkillDef> = {}) =>
    skill({
      id: 'slam',
      name: 'Paper-Binding Seal',
      qi: 30,
      effects: [{ type: 'hit', mult: 3 }],
      ...over,
    });

  it('pays its qi, winds up for 1 s, then lands', () => {
    const s = arena();
    const opts = book([], [slam({ cooldown: 50 })]);
    const mid = tick(s, 1.9, opts);
    const w = mid.combat.foe.windUp;
    expect(w).not.toBeNull();
    expect(w?.end).toBeCloseTo((w?.start ?? 0) + WIND_UP);
    expect(w?.name).toBe('Paper-Binding Seal');
    // An elite's pool is full at 60, so the regen step before adds nothing.
    expect(front(mid).qi).toBe(60 - 30);
    expect(mid.cultivator.hp).toBe(s.cultivator.hp);
    const done = tick(mid, 1, opts);
    expect(done.combat.foe.windUp).toBeNull();
    const hit = mitigate(front(s).damage * 3, derive(s.cultivator).defence);
    expect(done.cultivator.hp).toBe(s.cultivator.hp - hit);
    expect(casts(done).map((n) => [n.skill, n.windUp])).toEqual([
      ['Paper-Binding Seal', true],
      ['Paper-Binding Seal', false],
    ]);
  });

  it('winds up for its own time when it has one', () => {
    const mid = tick(arena(), 1.9, book([], [slam({ windUp: 2.5 })]));
    const w = mid.combat.foe.windUp;
    expect((w?.end ?? 0) - (w?.start ?? 0)).toBeCloseTo(2.5);
  });

  it('is cancelled by a stun: no hit, the qi lost, its attacks held to the stun end', () => {
    const s = arena();
    const fist = skill({
      id: 'fist',
      qi: 10,
      effects: [{ type: 'stun', duration: 1.5 }],
      when: (ctx) => ctx.other.windingUp,
    });
    const opts = book([fist], [slam({ cooldown: 100 })]);
    const after = tick(s, 3.5, opts);
    expect(after.cultivator.hp).toBe(s.cultivator.hp);
    expect(after.combat.foe.windUp).toBeNull();
    expect(front(after).qi).toBeLessThan(60 - 30 + 4);
    const effects = after.combat.log
      .filter((n) => 'effect' in n)
      .map((n) => [n.who, 'effect' in n && n.effect]);
    expect(effects).toEqual([
      ['foe', 'stunned'],
      ['foe', 'interrupted'],
    ]);
    const stun = after.combat.foe.stunUntil;
    expect(stun).toBeGreaterThan(0);
    expect(after.enemyNextAttackAt).toBeGreaterThanOrEqual(stun);
    // A stunned enemy starts no new wind-up until it wears off.
    expect(casts(after).filter((n) => n.who === 'foe' && n.at > stun - 1.5 && n.at < stun)).toEqual(
      [],
    );
  });

  it('is not interrupted by a stun once it landed', () => {
    const s = arena();
    const after = tick(s, 3, book([], [slam({ cooldown: 100 })]));
    expect(after.cultivator.hp).toBeLessThan(s.cultivator.hp);
  });
});

describe('effects', () => {
  /** The cultivator casts one skill of these effects once, from a quiet arena. */
  function cast(effects: Effect[], s = arena(), seconds = 2): GameState {
    return tick(s, seconds, book([skill({ effects, cooldown: 100 })]));
  }

  describe('hit', () => {
    it('hits at its share of the normal hit, through defence', () => {
      const s = arena();
      const d = derive(s.cultivator);
      const after = cast([{ type: 'hit', mult: 2.5, crit: 'never' }], s);
      expect(front(after).hp).toBe(1e6 - mitigate(d.damage * 2.5, front(s).defence));
    });

    it('always crits when told to', () => {
      const s = arena();
      const d = derive(s.cultivator);
      const after = cast([{ type: 'hit', mult: 2, crit: 'always' }], s);
      expect(front(after).hp).toBe(
        1e6 - mitigate(d.damage * 2 * d.critMultiplier, front(s).defence),
      );
    });

    it('hits several times', () => {
      const s = arena();
      const one = mitigate(derive(s.cultivator).damage, front(s).defence);
      const after = cast([{ type: 'hit', mult: 1, hits: 4, crit: 'never' }], s);
      expect(front(after).hp).toBe(1e6 - 4 * one);
    });

    it('spills onto the next enemies waiting, never a Tribulation', () => {
      const s = arena();
      const waiting = makeEnemy(1, 'demon', 'Second');
      waiting.maxHp = waiting.hp = 1e6;
      s.enemies.splice(1, 1, waiting, structuredClone(waiting));
      s.enemies.push(makeTribulation(1, 0));
      const tribHp = s.enemies[3]?.hp;
      const base = derive(s.cultivator).damage;
      const after = cast(
        [{ type: 'hit', mult: 1, crit: 'never', spill: { count: 5, mult: 0.5 } }],
        s,
      );
      const spilled = 1e6 - mitigate(base * 0.5, waiting.defence);
      expect(after.enemies.map((e) => e.hp)).toEqual([
        1e6 - mitigate(base, front(s).defence),
        spilled,
        spilled,
        tribHp,
      ]);
    });

    it('rewards a waiting enemy the spill kills, and the fight goes on', () => {
      const s = arena();
      (s.enemies[1] as { hp: number }).hp = 1;
      const fight = s.combat.fight;
      const after = cast([{ type: 'hit', mult: 1, spill: { count: 1, mult: 1 } }], s);
      expect(after.kills).toBe(1);
      expect(after.enemies).toHaveLength(1);
      expect(after.combat.fight).toBe(fight);
      expect(after.stones).toBeGreaterThan(s.stones);
    });

    it('stops at the kill: the rest of the skill ends with the fight', () => {
      const s = arena();
      front(s).hp = 1;
      const after = cast(
        [
          { type: 'hit', mult: 1, hits: 3 },
          { type: 'mod', stat: 'damage', amount: 1, duration: 10, on: 'self' },
        ],
        s,
      );
      expect(after.kills).toBe(1);
      expect(after.combat.you.mods).toEqual([]);
      expect(front(after).name).toBe('Waiting Demon');
    });
  });

  describe('buffs and debuffs', () => {
    it('speeds attacks for their duration, then end', () => {
      const s = arena('elite', { you: true, regen: true });
      const d = derive(s.cultivator);
      const after = cast(
        [{ type: 'mod', stat: 'attackSpeed', amount: 1, duration: 3, on: 'self' }],
        s,
      );
      const [mod] = after.combat.you.mods;
      expect(mod).toMatchObject({ stat: 'attackSpeed', amount: 1 });
      expect(modInterval(after.combat.you, d.attackInterval, after.time)).toBeCloseTo(
        d.attackInterval / 2,
      );
      expect(modInterval(after.combat.you, d.attackInterval, (mod?.until ?? 0) + 0.01)).toBe(
        d.attackInterval,
      );
    });

    it('a debuff on the enemy cuts its damage while it lasts', () => {
      const s = arena('elite', { foe: true, regen: true });
      const weak = cast(
        [{ type: 'mod', stat: 'damage', amount: -0.5, duration: 60, on: 'other' }],
        s,
        1.9,
      );
      const before = weak.cultivator.hp;
      // No regen steps from here, so HP moves by whole hits only.
      weak.qiNextAt = OFF;
      const later = tick(weak, front(s).attackInterval * 2, book([]));
      const per = mitigate(front(s).damage * 0.5, derive(s.cultivator).defence);
      expect((before - later.cultivator.hp) % per).toBe(0);
      expect(before - later.cultivator.hp).toBeGreaterThan(0);
    });

    it('damage taken goes up under a debuff', () => {
      const s = arena();
      const d = derive(s.cultivator);
      const after = cast(
        [
          { type: 'mod', stat: 'damageTaken', amount: 1, duration: 10, on: 'other' },
          { type: 'hit', mult: 1, crit: 'never' },
        ],
        s,
      );
      expect(front(after).hp).toBe(1e6 - mitigate(d.damage * 2, front(s).defence));
    });
  });

  it('shield: soaks damage until used up or run out', () => {
    const s = arena('elite', { foe: true, regen: true });
    const d = derive(s.cultivator);
    const after = cast([{ type: 'shield', share: 10, duration: 5 }], s, 1.9);
    const shield = after.combat.you.shield;
    expect(shield).toBe(Math.round(d.maxHp * 10));
    expect(after.combat.log.some((n) => 'effect' in n && n.effect === 'shielded')).toBe(true);
    const soaked = tick(after, 3, book([]));
    expect(soaked.cultivator.hp).toBe(after.cultivator.hp);
    expect(soaked.combat.you.shield).toBeLessThan(shield);
    const gone = tick(soaked, 10, book([]));
    expect(gone.cultivator.hp).toBeLessThan(after.cultivator.hp);
  });

  it('heal: up to max HP', () => {
    const s = arena();
    const max = derive(s.cultivator).maxHp;
    s.cultivator.hp = 10;
    // Against the same run with an empty skill: same pause, same HP regen.
    const without = cast([], s).cultivator.hp;
    expect(cast([{ type: 'heal', share: 0.25 }], s).cultivator.hp).toBe(
      without + Math.round(max * 0.25),
    );
    s.cultivator.hp = max - 1;
    expect(cast([{ type: 'heal', share: 0.25 }], s).cultivator.hp).toBe(max);
  });

  it('stun: holds the other side’s attacks to its end', () => {
    const s = arena('elite', { foe: true, regen: true });
    const after = cast([{ type: 'stun', duration: 5 }], s, 1.9);
    expect(after.enemyNextAttackAt).toBe(after.combat.foe.stunUntil);
    const held = tick(after, after.combat.foe.stunUntil - after.time - 0.01, book([]));
    expect(held.cultivator.hp).toBe(after.cultivator.hp);
  });

  it('silence: the other side casts nothing while it lasts', () => {
    const s = arena();
    const opts = book(
      [skill({ id: 'seal', effects: [{ type: 'silence', duration: 30 }], cooldown: 100 })],
      [
        skill({
          id: 'slam',
          qi: 30,
          effects: [{ type: 'hit', mult: 1 }],
          when: (c) => c.self.fightTime > 1.8,
        }),
      ],
    );
    const after = tick(s, 10, opts);
    expect(casts(after).filter((n) => n.who === 'foe')).toEqual([]);
    expect(after.combat.log.some((n) => 'effect' in n && n.effect === 'silenced')).toBe(true);
  });

  it('drain: takes qi, and a steal gives it to the caster up to its max', () => {
    const s = arena();
    s.cultivator.qi = 50;
    // The enemy's pool is full (60); it regains 1 at the 2 s regen step.
    const drained = cast([{ type: 'drain', amount: 45, steal: false }], s);
    expect(front(drained).qi).toBe(60 - 45 + 1);
    const stolen = cast([{ type: 'drain', amount: 100, steal: true }], s);
    expect(front(stolen).qi).toBe(1);
    const d = derive(s.cultivator);
    const atCast = Math.min(d.maxQi, 50 + d.qiRegen - 10 + 60);
    expect(stolen.cultivator.qi).toBe(Math.min(d.maxQi, atCast + d.qiRegen));
  });

  it('reflect: sends a share of each hit taken back', () => {
    const s = arena('elite', { foe: true, regen: true });
    const after = cast([{ type: 'reflect', share: 0.5, duration: 30 }], s, 1.9);
    const hp = front(after).hp;
    const later = tick(after, front(s).attackInterval, book([]));
    const taken = mitigate(front(s).damage, derive(s.cultivator).defence);
    expect(hp - front(later).hp).toBe(Math.max(1, Math.round(taken * 0.5)));
  });

  it("endure: HP can't drop below 1 while it lasts", () => {
    const s = arena('elite', { foe: true, regen: true });
    front(s).damage = 1e9;
    const after = cast([{ type: 'endure', duration: 30 }], s, 1.9);
    after.qiNextAt = OFF;
    const later = tick(after, front(s).attackInterval * 3, book([]));
    expect(later.cultivator.hp).toBe(1);
    expect(later.deaths).toBe(0);
  });
});

describe('effects the Path skills brought', () => {
  /** The cultivator casts one skill of these effects once, from a quiet arena. */
  function cast(effects: Effect[], s = arena(), seconds = 2, over: Partial<SkillDef> = {}) {
    return tick(s, seconds, book([skill({ effects, cooldown: 100, ...over })]));
  }

  describe('hit', () => {
    it('hits harder on an enemy below its low share, per hit', () => {
      const s = arena();
      const d = derive(s.cultivator);
      const low: Effect = { type: 'hit', mult: 1, crit: 'never', low: { below: 0.3, mult: 2 } };
      expect(front(cast([low], s)).hp).toBe(1e6 - mitigate(d.damage, front(s).defence));
      front(s).hp = 2e5;
      expect(front(cast([low], s)).hp).toBe(2e5 - mitigate(d.damage * 2, front(s).defence));
    });

    it('adds a share of max HP to each hit, never a crit', () => {
      const s = arena();
      const d = derive(s.cultivator);
      const after = cast([{ type: 'hit', mult: 1, crit: 'always', maxHp: 0.5 }], s);
      expect(front(after).hp).toBe(
        1e6 - mitigate(d.damage * d.critMultiplier + d.maxHp * 0.5, front(s).defence),
      );
    });

    it('gives back a share of the qi at a kill, once a cast', () => {
      const s = arena();
      front(s).hp = 1;
      const hit: Effect = { type: 'hit', mult: 1, hits: 3 };
      const plain = cast([hit], s, 2, { qi: 40 });
      const refunded = cast([{ ...hit, refund: 0.5 }], s, 2, { qi: 40 });
      expect(plain.kills).toBe(1);
      expect(refunded.cultivator.qi - plain.cultivator.qi).toBe(20);
      // A spill kill counts too, and the fight goes on.
      const spill = arena();
      (spill.enemies[1] as { hp: number }).hp = 1;
      const spilled = cast(
        [{ type: 'hit', mult: 1, spill: { count: 1, mult: 1 }, refund: 0.5 }],
        spill,
        2,
        { qi: 40 },
      );
      const none = cast([{ type: 'hit', mult: 1, spill: { count: 1, mult: 1 } }], spill, 2, {
        qi: 40,
      });
      expect(spilled.cultivator.qi - none.cultivator.qi).toBe(20);
    });

    it('reaches the whole wave with an endless spill, never a waiting Tribulation', () => {
      const s = arena();
      for (let i = 0; i < 4; i++) s.enemies.push(makeEnemy(1, 'demon', 'More'));
      for (const e of s.enemies.slice(1)) e.hp = 1;
      s.enemies.push(makeTribulation(1, 0));
      const trialHp = s.enemies[6]?.hp;
      const after = cast([{ type: 'hit', mult: 1, spill: { count: Infinity, mult: 1 } }], s);
      // The five demons waiting fall to it; the Tribulation is untouched.
      expect(after.kills).toBe(5);
      expect(after.enemies.map((e) => e.kind)).toEqual(['elite', 'tribulation']);
      expect(after.enemies[1]?.hp).toBe(trialHp);
    });
  });

  it(`skill damage gains ${SKILL_DAMAGE_PER_SPIRIT * 100}% a point of Spirit, on every Path`, () => {
    for (const path of ['sword', 'body', 'talisman'] as const) {
      const s = arena();
      s.cultivator.path = path;
      s.cultivator.stats.spirit = 100;
      const d = derive(s.cultivator);
      const spirit = effectiveStats(s.cultivator).spirit;
      const after = cast([{ type: 'hit', mult: 2, crit: 'never' }], s);
      expect(front(after).hp).toBe(
        1e6 -
          mitigate(
            d.damage * 2 * (1 + SKILL_DAMAGE_PER_SPIRIT * spirit),
            front(s).defence,
            d.pierce,
          ),
      );
    }
  });

  it('a relative mod is a share of the stat it moves: +1 lifesteal doubles it', () => {
    const s = arena();
    s.cultivator.path = 'body';
    const d = derive(s.cultivator);
    const after = cast(
      [{ type: 'mod', stat: 'lifesteal', amount: 1, duration: 6, on: 'self', relative: true }],
      s,
    );
    expect(after.combat.you.mods).toMatchObject([{ stat: 'lifesteal', amount: d.lifesteal }]);
  });

  it('shield burst: the hit that breaks it deals its full worth, past defence', () => {
    const s = arena('elite', { foe: true, regen: true });
    s.enemyNextAttackAt = 3;
    const shielded = cast([{ type: 'shield', share: 0.05, duration: 30, burst: 1 }], s, 2.5);
    const worth = shielded.combat.you.shield;
    expect(worth).toBeGreaterThan(0);
    expect(worth).toBeLessThan(mitigate(front(s).damage, derive(s.cultivator).defence));
    expect(front(shielded).hp).toBe(1e6);
    const broken = tick(shielded, 1, book([]));
    expect(broken.combat.you.shield).toBe(0);
    expect(front(broken).hp).toBe(1e6 - worth);
    // Once: the next hits send nothing more.
    expect(front(tick(broken, 10, book([]))).hp).toBe(front(broken).hp);
  });

  it('bursts at once when a reflect breaks it, and a burst sets off the other side’s', () => {
    // The enemy reflects all; the cultivator's 1-HP shield bursts for 50.
    const s = arena('elite', { you: true, regen: true });
    s.combat.foe.reflect = 1;
    s.combat.foe.reflectUntil = OFF;
    Object.assign(s.combat.you, { shield: 1, shieldUntil: OFF, shieldBurst: 50 });
    const d = derive(s.cultivator);
    const dealt = mitigate(d.damage, front(s).defence);
    s.cultivator.nextAttackAt = 1.5;
    const after = tick(s, 1.6, book([]));
    expect(after.combat.you).toMatchObject({ shield: 0, shieldBurst: 0, burstDue: 0 });
    expect(front(after).hp).toBe(1e6 - dealt - 50);
    // The enemy's own shield bursts for 5, breaking the cultivator's: it bursts in turn.
    const both = arena('elite', { you: true, regen: true });
    Object.assign(both.combat.foe, { shield: 1, shieldUntil: OFF, shieldBurst: 5 });
    Object.assign(both.combat.you, { shield: 1, shieldUntil: OFF, shieldBurst: 50 });
    both.cultivator.nextAttackAt = 1.5;
    const chain = tick(both, 1.6, book([]));
    expect(chain.combat.foe.burstDue + chain.combat.you.burstDue).toBe(0);
    expect(front(chain).hp).toBe(1e6 - (dealt - 1) - 50);
    expect(chain.cultivator.hp).toBe(d.maxHp - 4);
  });

  it('a shield that runs out unbroken never bursts', () => {
    const s = arena();
    const after = cast([{ type: 'shield', share: 0.05, duration: 1, burst: 1 }], s, 5);
    expect(front(after).hp).toBe(1e6);
  });

  it('endure: heals its share of max HP as it ends, in the same fight', () => {
    const s = arena();
    s.cultivator.hp = 10;
    const max = derive(s.cultivator).maxHp;
    const plain = cast([{ type: 'endure', duration: 2 }], s, 5);
    const healed = cast([{ type: 'endure', duration: 2, heal: 0.5 }], s, 5);
    expect(healed.cultivator.hp - plain.cultivator.hp).toBe(Math.round(max * 0.5));
    // Not before it ends.
    const early = cast([{ type: 'endure', duration: 2, heal: 0.5 }], s, 2.5);
    expect(early.combat.you.endureHeal).toBe(0.5);
  });

  describe('evade', () => {
    /** An enemy that hits hard, first at 3 s, every 2 s; the cultivator evades. */
    function evading(counter = false): GameState {
      const s = arena('elite', { foe: true, regen: true });
      s.enemyNextAttackAt = 3;
      front(s).damage = 30;
      return cast([{ type: 'evade', hits: 2, counter }], s, 2.5);
    }

    it('turns aside the next normal attacks, then they land', () => {
      const s = evading();
      expect(s.combat.you.evades).toBe(2);
      const hp = s.cultivator.hp;
      const two = tick(s, 3, book([]));
      expect(two.combat.you.evades).toBe(0);
      expect(two.cultivator.hp).toBe(hp);
      expect(tick(two, 2, book([])).cultivator.hp).toBeLessThan(hp);
    });

    it('answers each with a crit at the normal hit when it counters', () => {
      const s = evading(true);
      const d = derive(s.cultivator);
      const after = tick(s, 3, book([]));
      expect(front(after).hp).toBe(
        1e6 - 2 * mitigate(d.damage * d.critMultiplier, front(s).defence),
      );
      expect(front(tick(evading(), 3, book([]))).hp).toBe(1e6);
    });

    it("turns aside the other side's next skill whole, using every evade", () => {
      const s = arena();
      const slam = skill({
        id: 'slam',
        qi: 30,
        cooldown: 100,
        effects: [
          { type: 'hit', mult: 5 },
          { type: 'stun', duration: 3 },
          { type: 'heal', share: 0.5 },
        ],
        when: (c) => c.self.fightTime > 1.5,
      });
      front(s).hp = 1000;
      const step = skill({
        id: 'step',
        effects: [{ type: 'evade', hits: 2, counter: true }],
        cooldown: 100,
      });
      const after = tick(s, 4, book([step], [slam]));
      const d = derive(s.cultivator);
      expect(casts(after).map((n) => [n.who, n.skill, n.windUp])).toEqual([
        ['you', 'Test Skill', false],
        ['foe', 'Test Skill', true],
        ['foe', 'Test Skill', false],
      ]);
      expect(after.combat.you.evades).toBe(0);
      expect(after.cultivator.hp).toBe(d.maxHp);
      expect(after.combat.you.stunUntil).toBe(0);
      // Its own heal still lands, then the counter's crit.
      expect(front(after).hp).toBe(
        1000 + 5e5 - mitigate(d.damage * d.critMultiplier, front(s).defence),
      );
    });
  });

  describe('burn', () => {
    it('ticks its share over its duration, once a BURN_TICK, through defence', () => {
      const s = arena();
      const d = derive(s.cultivator);
      const burnt = cast([{ type: 'burn', mult: 0.6, duration: 3 }], s, 6);
      const tickHit = mitigate((d.damage * 0.6) / 3, front(s).defence);
      expect(front(burnt).hp).toBe(1e6 - 3 * tickHit);
      expect(burnt.combat.foe.burns).toEqual([]);
      const [at] = casts(burnt);
      const mid = cast([{ type: 'burn', mult: 0.6, duration: 3 }], s, (at?.at ?? 0) + BURN_TICK);
      expect(front(mid).hp).toBe(1e6 - tickHit);
    });

    it('replaces the last burn, unless burns stack', () => {
      const again = (stack: boolean) =>
        tick(
          arena(),
          3,
          book([skill({ effects: [{ type: 'burn', mult: 1, duration: 3, stack }], cooldown: 1 })]),
        );
      expect(casts(again(false)).length).toBeGreaterThan(1);
      expect(again(false).combat.foe.burns).toHaveLength(1);
      expect(again(true).combat.foe.burns.length).toBeGreaterThan(1);
    });

    it('caps stacked burns, dropping the oldest', () => {
      const s = arena();
      const many = tick(
        s,
        MAX_BURNS * 2,
        book([skill({ effects: [{ type: 'burn', mult: 1, duration: 60, stack: true }], qi: 1 })]),
      );
      expect(many.combat.foe.burns).toHaveLength(MAX_BURNS);
    });

    it('a burn tick kills like any hit, and the rules see the burn', () => {
      const s = arena();
      front(s).hp = 3;
      (s.enemies[1] as { hp: number }).hp = 1e6;
      const seen: boolean[] = [];
      const after = tick(
        s,
        6,
        book([
          skill({
            effects: [{ type: 'burn', mult: 100, duration: 3 }],
            when: (c) => (seen.push(c.other.burning), !c.other.burning),
          }),
        ]),
      );
      expect(after.kills).toBe(1);
      expect(casts(after).length).toBeGreaterThanOrEqual(1);
      expect(seen).toContain(true);
    });

    it('ends with the fight', () => {
      const s = arena();
      const burnt = cast([{ type: 'burn', mult: 1, duration: 30 }], s);
      expect(burnt.combat.foe.burns).toHaveLength(1);
      front(burnt).hp = 1;
      burnt.cultivator.nextAttackAt = burnt.time + 0.1;
      expect(tick(burnt, 0.2, book([])).combat.foe.burns).toEqual([]);
    });
  });
});

describe('rule 4 and the rule context the Path skills brought', () => {
  it('casts a buff again only once its buff on the caster ended', () => {
    const s = arena();
    const buff = skill({
      effects: [{ type: 'mod', stat: 'damage', amount: 1, duration: 5, on: 'self' }],
    });
    const after = tick(s, 5.5, book([buff]));
    expect(casts(after)).toHaveLength(1);
    expect(casts(tick(s, 8, book([buff])))).toHaveLength(2);
    // Only its own buff counts: the same stat from another skill doesn't.
    const r = inputs();
    r.status.mods.push({ stat: 'damage', amount: 1, until: 11, source: 'other' });
    expect(usable(buff, [buff], r)).toBe(true);
    r.status.mods.push({ stat: 'damage', amount: 1, until: 11, source: 'test' });
    expect(usable(buff, [buff], r)).toBe(false);
  });

  it('never holds a skill with a heal or a hit by the buffs it also gives', () => {
    const r = inputs();
    r.status.mods.push({ stat: 'lifesteal', amount: 0.2, until: 15, source: 'test' });
    const surge = skill({
      effects: [
        { type: 'heal', share: 0.25 },
        { type: 'mod', stat: 'lifesteal', amount: 1, duration: 6, on: 'self', relative: true },
      ],
    });
    expect(buffed(surge, r.status, r.now)).toBe(false);
    expect(usable(surge, [surge], r)).toBe(true);
  });

  it('casts a shield again once it broke, not only once it ran out', () => {
    const shield = skill({ effects: [{ type: 'shield', share: 0.2, duration: 8 }] });
    const r = inputs();
    r.status.shield = 5;
    r.status.shieldUntil = 18;
    expect(buffed(shield, r.status, r.now)).toBe(true);
    r.status.shield = 0;
    expect(buffed(shield, r.status, r.now)).toBe(false);
    // In a fight: hits break it and it comes back before its 8 s are up.
    const s = arena('elite', { foe: true, regen: true });
    front(s).damage = 30;
    s.cultivator.hp = 1e4;
    const tiny = skill({
      effects: [{ type: 'shield', share: 0.01, duration: 8 }],
      qi: 1,
    });
    const after = tick(s, 7, book([tiny]));
    expect(casts(after).length).toBeGreaterThan(1);
  });

  it('holds evades, endure and reflect while they work', () => {
    const r = inputs();
    const step = skill({ effects: [{ type: 'evade', hits: 2 }] });
    const vajra = skill({ effects: [{ type: 'endure', duration: 4 }] });
    const mirror = skill({ effects: [{ type: 'reflect', share: 0.5, duration: 4 }] });
    for (const def of [step, vajra, mirror]) expect(buffed(def, r.status, r.now)).toBe(false);
    r.status.evades = 1;
    r.status.endureUntil = 12;
    r.status.reflect = 0.5;
    r.status.reflectUntil = 12;
    for (const def of [step, vajra, mirror]) expect(buffed(def, r.status, r.now)).toBe(true);
  });

  it('lets an urgent defensive skill skip the HP-or-wind-up gate', () => {
    const guard = skill({ kind: 'defensive', urgent: (c) => c.incoming > 50 });
    expect(usable(guard, [guard], inputs({ incoming: 50 }))).toBe(false);
    expect(usable(guard, [guard], inputs({ incoming: 51 }))).toBe(true);
  });

  it('tells a rule how many enemies a spill reaches, never a waiting Tribulation', () => {
    const s = arena();
    s.enemies.push(makeTribulation(1, 0));
    const seen: [number, number][] = [];
    tick(s, 1.5, book([skill({ when: (c) => (seen.push([c.waveLeft, c.reachable]), false) })]));
    expect(seen[0]).toEqual([3, 2]);
  });

  it("tells a rule the other side's next normal hit, after defence", () => {
    const s = arena('elite', { regen: true });
    const seen: number[] = [];
    tick(s, 1.5, book([skill({ when: (c) => (seen.push(c.incoming), false) })]));
    expect(seen[0]).toBe(mitigate(front(s).damage, derive(s.cultivator).defence));
  });

  it('marks an elite, a boss and a Tribulation; a boss and a Tribulation alone as boss or tougher', () => {
    expect((['demon', 'elite', 'boss', 'tribulation'] as const).map(bossOrTougher)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });
});

describe('a loss to a skill', () => {
  /** A Tribulation in front, the cultivator at 1 HP. */
  function trial(on: { you?: boolean } = {}): GameState {
    const s = arena('elite', { regen: true, ...on });
    const t = makeTribulation(s.floor, 0);
    t.maxHp = t.hp = 1e6;
    t.qi = 150;
    s.enemies = [t];
    s.cultivator.hp = 1;
    return s;
  }

  it('to a Tribulation skill hit counts towards the retry limit, on the same floor', () => {
    const s = trial();
    // Chosen at 1 s, a pause of up to 0.8 s, then a 1 s wind-up.
    const after = tick(
      s,
      3,
      book([], [skill({ id: 'slam', qi: 30, effects: [{ type: 'hit', mult: 1 }] })]),
    );
    expect(after.deaths).toBe(1);
    expect(after.floor).toBe(s.floor);
    expect(after.trial.losses).toBe(s.trial.losses + 1);
  });

  it("to a Tribulation's reflect counts too", () => {
    const s = trial({ you: true });
    s.combat.foe.reflect = 1000;
    s.combat.foe.reflectUntil = OFF;
    const after = tick(s, s.cultivator.nextAttackAt + 0.01);
    expect(after.deaths).toBe(1);
    expect(after.floor).toBe(s.floor);
    expect(after.trial.losses).toBe(s.trial.losses + 1);
  });
});

describe('fight end', () => {
  const lasting: SkillDef[] = [
    skill({
      id: 'all',
      cooldown: 999,
      effects: [
        { type: 'mod', stat: 'damage', amount: 0.5, duration: 999, on: 'self' },
        { type: 'mod', stat: 'defence', amount: -0.5, duration: 999, on: 'other' },
        { type: 'shield', share: 0.1, duration: 999 },
        { type: 'reflect', share: 0.1, duration: 999 },
        { type: 'endure', duration: 0.1 },
        { type: 'silence', duration: 999 },
      ],
    }),
  ];
  const winding = [skill({ id: 'slam', qi: 30, effects: [{ type: 'hit', mult: 1 }] })];

  function clean(s: GameState) {
    expect(s.combat.you).toEqual(freshStatus());
    expect(s.combat.foe).toEqual(freshStatus());
  }

  it('ends every buff, debuff, shield, cooldown and wind-up at a kill; the callouts stay', () => {
    const s = arena('elite', { regen: true });
    const busy = tick(s, 1.9, book(lasting, winding));
    expect(busy.combat.you.mods.length).toBeGreaterThan(0);
    front(busy).hp = 1;
    busy.cultivator.nextAttackAt = busy.time + 0.01;
    const after = tick(busy, 0.02, book([], []));
    expect(after.kills).toBe(1);
    clean(after);
    expect(after.combat.log).toEqual(busy.combat.log);
  });

  it('ends them at a loss too', () => {
    const s = arena('elite', { regen: true });
    const busy = tick(s, 1.9, book(lasting, winding));
    busy.cultivator.hp = 1;
    busy.combat.you.endureUntil = 0;
    busy.combat.you.shield = 0;
    busy.enemyNextAttackAt = busy.time + 0.01;
    const after = tick(busy, 0.02, book([], []));
    expect(after.deaths).toBe(1);
    clean(after);
  });

  it('ends them when a Tribulation is faced early', () => {
    let s = newGame(7, 'sword');
    for (let t = 0; t < 3600 && !canFaceTribulation(s); t++) s = tick(s, 1);
    expect(canFaceTribulation(s)).toBe(true);
    s.cultivator.qi = derive(s.cultivator).maxQi;
    // Out of reach of a kill, which would end the buffs first.
    front(s).hp = 1e6;
    const busy = tick(s, 1.9, book(lasting));
    expect(busy.combat.you.mods.length).toBeGreaterThan(0);
    clean(faceTribulation(busy));
  });
});
