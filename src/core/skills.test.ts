import { describe, expect, it } from 'vitest';
import { derive } from './cultivator.ts';
import { makeEnemy, makeTribulation, type EnemyKind } from './floors.ts';
import {
  CAST_PAUSE,
  chooseSkill,
  cooldownFor,
  DEFENSIVE_HP_SHARE,
  freshCombat,
  freshStatus,
  HOLD_WITHIN_QI,
  LOG_SIZE,
  modInterval,
  note,
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
  return { hp: 100, maxHp: 100, qi: 100, maxQi: 100, windingUp: false, fightTime: 5, ...over };
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
    expect(tick(s, 30, book([])).rng).toEqual(tick(s, 30).rng);
    expect(tick(s, 30, { loadout: noSkills })).toEqual(tick(s, 30));
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
    skill({ id: 'slam', name: 'Paper Jam', qi: 30, effects: [{ type: 'hit', mult: 3 }], ...over });

  it('pays its qi, winds up for 1 s, then lands', () => {
    const s = arena();
    const opts = book([], [slam({ cooldown: 50 })]);
    const mid = tick(s, 1.9, opts);
    const w = mid.combat.foe.windUp;
    expect(w).not.toBeNull();
    expect(w?.end).toBeCloseTo((w?.start ?? 0) + WIND_UP);
    expect(w?.name).toBe('Paper Jam');
    // An elite's pool is full at 60, so the regen step before adds nothing.
    expect(front(mid).qi).toBe(60 - 30);
    expect(mid.cultivator.hp).toBe(s.cultivator.hp);
    const done = tick(mid, 1, opts);
    expect(done.combat.foe.windUp).toBeNull();
    const hit = mitigate(front(s).damage * 3, derive(s.cultivator).defence);
    expect(done.cultivator.hp).toBe(s.cultivator.hp - hit);
    expect(casts(done).map((n) => [n.skill, n.windUp])).toEqual([
      ['Paper Jam', true],
      ['Paper Jam', false],
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
    expect(cast([{ type: 'heal', share: 0.25 }], s).cultivator.hp).toBe(
      10 + Math.round(max * 0.25),
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
    const later = tick(after, front(s).attackInterval * 3, book([]));
    expect(later.cultivator.hp).toBe(1);
    expect(later.deaths).toBe(0);
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
