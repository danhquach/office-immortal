import { describe, expect, it } from 'vitest';
import { derive, PATH_IDS, realmLevels, REALMS, type PathId } from './cultivator.ts';
import { changePath } from './economy.ts';
import { makeEnemy, makeTribulation, type EnemyKind } from './floors.ts';
import {
  INTENT_HP_SHARE,
  LOW_HP_SHARE,
  pathSkills,
  pathStep,
  PATH_SKILL_NAMES,
  SEAL_QI_SHARE,
  SURGE_HP_SHARE,
  VAJRA_HP_SHARE,
} from './path-skills.ts';
import {
  freshStatus,
  usable,
  type FighterView,
  type RuleInputs,
  type SkillContext,
  type SkillDef,
} from './skills.ts';
import {
  gameSkills,
  mitigate,
  newGame,
  retire,
  tick,
  type GameState,
  type Loadout,
} from './sim.ts';

const OFF = 1e15;

/**
 * What each realm brings each Path, Qi Condensation to Immortal Ascension:
 * the skill's name and its rank (1 learned, 2 and on upgrades).
 */
const TABLE: Readonly<Record<PathId, readonly (readonly [string, string, number])[]>> = {
  sword: [
    ['flyingSword', 'Flying Sword', 1],
    ['swordIntent', 'Sword Intent', 1],
    ['flyingSword', 'Flying Sword', 2],
    ['lightningStep', 'Lightning Step', 1],
    ['swordIntent', 'Sword Intent', 2],
    ['tenThousandSwords', 'Ten Thousand Swords', 1],
    ['lightningStep', 'Lightning Step', 2],
    ['flyingSword', 'Flying Sword', 3],
    ['tenThousandSwords', 'Ten Thousand Swords', 2],
    ['swordIntent', 'Sword Intent', 3],
  ],
  body: [
    ['ironSkin', 'Iron Skin', 1],
    ['mountainFist', 'Mountain Fist', 1],
    ['ironSkin', 'Iron Skin', 2],
    ['bloodQiSurge', 'Blood Qi Surge', 1],
    ['mountainFist', 'Mountain Fist', 2],
    ['vajraBody', 'Vajra Body', 1],
    ['bloodQiSurge', 'Blood Qi Surge', 2],
    ['ironSkin', 'Iron Skin', 3],
    ['vajraBody', 'Vajra Body', 2],
    ['mountainFist', 'Mountain-Toppling Palm', 3],
  ],
  talisman: [
    ['fireTalisman', 'Fire Talisman', 1],
    ['thunderTalisman', 'Thunder Talisman', 1],
    ['spiritShield', 'Spirit Shield', 1],
    ['fireTalisman', 'Fire Talisman', 2],
    ['sealingTalisman', 'Sealing Talisman', 1],
    ['thunderTalisman', 'Thunder Talisman', 2],
    ['spiritShield', 'Spirit Shield', 2],
    ['sealingTalisman', 'Sealing Talisman', 2],
    ['fireTalisman', 'Fire Talisman', 3],
    ['thunderTalisman', 'Heavenly Thunder Array', 3],
  ],
};

/** `path`'s skill `id` in realm `realm`. */
function at(path: PathId, realm: number, id: string): SkillDef {
  const def = pathSkills(path, realm).find((k) => k.id === id);
  if (!def) throw new Error(`${path} has no ${id} in realm ${realm}`);
  return def;
}

describe('what each Path learns, realm by realm', () => {
  it('has ten realms', () => {
    expect(REALMS).toHaveLength(10);
  });

  for (const path of PATH_IDS) {
    it(`${path}: one new skill or upgrade at every realm, as the table says`, () => {
      const known = new Map<string, string>();
      TABLE[path].forEach(([id, name, rank], realm) => {
        expect(pathStep(path, realm), `realm ${realm}`).toEqual({ id, name, rank });
        if (rank === 1) expect(known.has(id)).toBe(false);
        else expect(known.has(id)).toBe(true);
        known.set(id, name);
        // Every skill known so far, in the order learned, under its current name.
        expect(pathSkills(path, realm).map((k) => [k.id, k.name])).toEqual([...known]);
      });
      expect(known.size).toBe(4);
    });
  }

  it('clamps a realm out of range to the nearest one', () => {
    expect(pathSkills('sword', -3)).toEqual(pathSkills('sword', 0));
    expect(pathSkills('sword', 99)).toEqual(pathSkills('sword', 9));
    expect(pathSkills('sword', 2.7)).toEqual(pathSkills('sword', 2));
    expect(pathStep('sword', 10)).toBeNull();
  });

  it('names every skill once, renamed upgrades included, for the language packs', () => {
    expect(PATH_SKILL_NAMES).toHaveLength(14);
    expect(PATH_SKILL_NAMES).toContain('Mountain-Toppling Palm');
    expect(PATH_SKILL_NAMES).toContain('Heavenly Thunder Array');
  });

  it('costs qi and has no cooldown, so the qi cost is the limit', () => {
    for (const path of PATH_IDS) {
      for (const def of pathSkills(path, 9)) {
        expect(def.qi).toBeGreaterThan(0);
        expect(def.cooldown).toBe(0);
      }
    }
  });
});

describe('Path skill effects, by rank', () => {
  it('Flying Sword: 250% always a crit; then two swords at 150%; then a kill refunds half', () => {
    expect(at('sword', 0, 'flyingSword')).toMatchObject({
      qi: 30,
      kind: 'damage',
      effects: [{ type: 'hit', mult: 2.5, crit: 'always' }],
    });
    expect(at('sword', 2, 'flyingSword').effects).toEqual([
      { type: 'hit', mult: 1.5, hits: 2, crit: 'always' },
    ]);
    expect(at('sword', 7, 'flyingSword').effects).toEqual([
      { type: 'hit', mult: 1.5, hits: 2, crit: 'always', refund: 0.5 },
    ]);
  });

  it('Sword Intent: +40% attack speed 6 s; then +15% crit; then 10 s for 35 qi', () => {
    expect(at('sword', 1, 'swordIntent')).toMatchObject({
      qi: 45,
      effects: [{ type: 'mod', stat: 'attackSpeed', amount: 0.4, duration: 6, on: 'self' }],
    });
    expect(at('sword', 4, 'swordIntent').effects).toEqual([
      { type: 'mod', stat: 'attackSpeed', amount: 0.4, duration: 6, on: 'self' },
      { type: 'mod', stat: 'critChance', amount: 0.15, duration: 6, on: 'self' },
    ]);
    expect(at('sword', 9, 'swordIntent')).toMatchObject({
      qi: 35,
      effects: [{ duration: 10 }, { duration: 10 }],
    });
  });

  it('Lightning Step: evades 2 hits or a skill; then each dodge answers with a crit', () => {
    expect(at('sword', 3, 'lightningStep')).toMatchObject({
      qi: 35,
      kind: 'defensive',
      effects: [{ type: 'evade', hits: 2 }],
    });
    expect(at('sword', 3, 'lightningStep').effects[0]).not.toHaveProperty('counter');
    expect(at('sword', 6, 'lightningStep').effects).toEqual([
      { type: 'evade', hits: 2, counter: true },
    ]);
  });

  it('Ten Thousand Swords: 6 × 100%, double below 30% HP; then 8 hits', () => {
    const low = { below: LOW_HP_SHARE, mult: 2 };
    expect(LOW_HP_SHARE).toBe(0.3);
    expect(at('sword', 5, 'tenThousandSwords')).toMatchObject({
      qi: 90,
      effects: [{ type: 'hit', mult: 1, hits: 6, low }],
    });
    expect(at('sword', 8, 'tenThousandSwords').effects).toEqual([
      { type: 'hit', mult: 1, hits: 8, low },
    ]);
  });

  it('Iron Skin: +60% defence 6 s; then reflects 25%; then costs 20 qi', () => {
    const skin = { type: 'mod', stat: 'defence', amount: 0.6, duration: 6, on: 'self' };
    expect(at('body', 0, 'ironSkin')).toMatchObject({ qi: 30, kind: 'defensive', effects: [skin] });
    const reflect = { type: 'reflect', share: 0.25, duration: 6 };
    expect(at('body', 2, 'ironSkin')).toMatchObject({ qi: 30, effects: [skin, reflect] });
    expect(at('body', 7, 'ironSkin')).toMatchObject({ qi: 20, effects: [skin, reflect] });
  });

  it('Mountain Fist: 200% and a 1 s stun; then 1.5 s and +10% max HP; then the Palm', () => {
    expect(at('body', 1, 'mountainFist')).toMatchObject({
      qi: 40,
      effects: [
        { type: 'hit', mult: 2 },
        { type: 'stun', duration: 1 },
      ],
    });
    expect(at('body', 4, 'mountainFist').effects).toEqual([
      { type: 'hit', mult: 2, maxHp: 0.1 },
      { type: 'stun', duration: 1.5 },
    ]);
    expect(at('body', 9, 'mountainFist')).toMatchObject({
      name: 'Mountain-Toppling Palm',
      qi: 40,
      effects: [
        { type: 'hit', mult: 3, maxHp: 0.15 },
        { type: 'stun', duration: 1.5 },
      ],
    });
  });

  it('Blood Qi Surge: heals 25%; then doubles lifesteal for 6 s', () => {
    expect(at('body', 3, 'bloodQiSurge')).toMatchObject({
      qi: 55,
      effects: [{ type: 'heal', share: 0.25 }],
    });
    expect(at('body', 6, 'bloodQiSurge').effects).toEqual([
      { type: 'heal', share: 0.25 },
      { type: 'mod', stat: 'lifesteal', amount: 1, duration: 6, on: 'self', relative: true },
    ]);
  });

  it('Vajra Body: no dropping below 1 HP for 4 s, then heals 10%; then 6 s', () => {
    expect(at('body', 5, 'vajraBody')).toMatchObject({
      qi: 80,
      effects: [{ type: 'endure', duration: 4, heal: 0.1 }],
    });
    expect(at('body', 8, 'vajraBody').effects).toEqual([
      { type: 'endure', duration: 6, heal: 0.1 },
    ]);
  });

  it('Fire Talisman: 220% and a 50% burn over 3 s; then burns stack; then costs 20 qi', () => {
    const hit = { type: 'hit', mult: 2.2 };
    expect(at('talisman', 0, 'fireTalisman')).toMatchObject({
      qi: 30,
      effects: [hit, { type: 'burn', mult: 0.5, duration: 3 }],
    });
    expect(at('talisman', 0, 'fireTalisman').effects[1]).not.toHaveProperty('stack');
    const stacking = [hit, { type: 'burn', mult: 0.5, duration: 3, stack: true }];
    expect(at('talisman', 3, 'fireTalisman')).toMatchObject({ qi: 30, effects: stacking });
    expect(at('talisman', 8, 'fireTalisman')).toMatchObject({ qi: 20, effects: stacking });
  });

  it('Thunder Talisman: 180% and 90% on the next; then the 3 next; then the Array', () => {
    expect(at('talisman', 1, 'thunderTalisman')).toMatchObject({
      qi: 45,
      effects: [{ type: 'hit', mult: 1.8, spill: { count: 1, mult: 0.9 } }],
    });
    expect(at('talisman', 5, 'thunderTalisman').effects).toEqual([
      { type: 'hit', mult: 1.8, spill: { count: 3, mult: 0.9 } },
    ]);
    expect(at('talisman', 9, 'thunderTalisman')).toMatchObject({
      name: 'Heavenly Thunder Array',
      qi: 45,
      effects: [{ type: 'hit', mult: 2, spill: { count: Infinity, mult: 2 } }],
    });
  });

  it('Spirit Shield: 20% of max HP for 8 s; then it bursts for its worth when broken', () => {
    expect(at('talisman', 2, 'spiritShield')).toMatchObject({
      qi: 40,
      kind: 'defensive',
      effects: [{ type: 'shield', share: 0.2, duration: 8 }],
    });
    expect(at('talisman', 6, 'spiritShield').effects).toEqual([
      { type: 'shield', share: 0.2, duration: 8, burst: 1 },
    ]);
  });

  it('Sealing Talisman: empties qi and silences 5 s; then 8 s and steals it', () => {
    expect(at('talisman', 4, 'sealingTalisman')).toMatchObject({
      qi: 50,
      effects: [
        { type: 'drain', amount: Infinity, steal: false },
        { type: 'silence', duration: 5 },
      ],
    });
    expect(at('talisman', 7, 'sealingTalisman').effects).toEqual([
      { type: 'drain', amount: Infinity, steal: true },
      { type: 'silence', duration: 8 },
    ]);
  });
});

describe('Path skills in a fight', () => {
  /**
   * A cultivator of `path` at the start of realm `realm`, before an elite with
   * 1e6 HP and full qi, three demons waiting. No Agility or Spirit, crits off
   * unless a skill always crits, and nobody attacks: only the cast happens.
   */
  function arena(path: PathId, realm: number, seed = 3): GameState {
    const s = newGame(seed, path);
    const c = s.cultivator;
    c.level = realmLevels(realm).from;
    c.stats.agility = 0;
    c.stats.spirit = 0;
    const elite = makeEnemy(1, 'elite', 'Test Demon');
    elite.maxHp = elite.hp = 1e6;
    elite.qi = 60;
    const waiting = () => {
      const e = makeEnemy(1, 'demon', 'Waiting Demon');
      e.maxHp = e.hp = 1e6;
      return e;
    };
    s.enemies = [elite, waiting(), waiting(), waiting()];
    const d = derive(c);
    c.hp = d.maxHp;
    c.qi = d.maxQi;
    c.nextAttackAt = OFF;
    s.enemyNextAttackAt = OFF;
    s.combat.you.mods.push({ stat: 'critChance', amount: -1, until: OFF });
    return s;
  }

  /** Casts `path`'s `id` once, its rules set aside, and gives the state and the cast time. */
  function cast(path: PathId, realm: number, id: string, s = arena(path, realm), seconds = 2) {
    const def = at(path, realm, id);
    const only: Loadout = (_s, side) =>
      side === 'you' ? [{ ...def, kind: 'other', cooldown: 100, when: () => true }] : [];
    const after = tick(s, seconds, { loadout: only });
    const note = after.combat.log.find((n) => 'skill' in n && n.who === 'you');
    if (!note) throw new Error(`${id} was not cast`);
    return { s, after, d: derive(s.cultivator), when: note.at };
  }

  const front = (s: GameState) => s.enemies[0] as { hp: number; qi: number; defence: number };

  it('Flying Sword crits for 250%, then twice for 150%, then a kill refunds 15 qi', () => {
    let r = cast('sword', 0, 'flyingSword');
    expect(front(r.after).hp).toBe(
      1e6 - mitigate(r.d.damage * 2.5 * r.d.critMultiplier, front(r.s).defence),
    );
    r = cast('sword', 2, 'flyingSword');
    expect(front(r.after).hp).toBe(
      1e6 - 2 * mitigate(r.d.damage * 1.5 * r.d.critMultiplier, front(r.s).defence),
    );
    const s = arena('sword', 7);
    front(s).hp = 1;
    r = cast('sword', 7, 'flyingSword', s);
    expect(r.after.kills).toBe(1);
    expect(r.after.cultivator.qi).toBe(Math.min(r.d.maxQi, r.d.maxQi - 30 + 15 + r.d.qiRegen));
  });

  it('Sword Intent speeds attacks, adds crit, and lasts 10 s for 35 qi at the top', () => {
    let r = cast('sword', 1, 'swordIntent');
    expect(r.after.combat.you.mods.slice(1)).toEqual([
      { stat: 'attackSpeed', amount: 0.4, until: r.when + 6, source: 'swordIntent' },
    ]);
    r = cast('sword', 4, 'swordIntent');
    expect(r.after.combat.you.mods.slice(1)).toEqual([
      { stat: 'attackSpeed', amount: 0.4, until: r.when + 6, source: 'swordIntent' },
      { stat: 'critChance', amount: 0.15, until: r.when + 6, source: 'swordIntent' },
    ]);
    r = cast('sword', 9, 'swordIntent');
    expect(r.after.combat.you.mods.slice(1).map((m) => m.until)).toEqual([
      r.when + 10,
      r.when + 10,
    ]);
    expect(r.after.cultivator.qi).toBe(Math.min(r.d.maxQi, r.d.maxQi - 35 + r.d.qiRegen));
  });

  it('Lightning Step evades 2 hits; at Body Integration each answers with a crit', () => {
    let r = cast('sword', 3, 'lightningStep');
    expect(r.after.combat.you).toMatchObject({ evades: 2, counter: false });
    r = cast('sword', 6, 'lightningStep');
    expect(r.after.combat.you).toMatchObject({ evades: 2, counter: true });
    // Two enemy attacks turned aside, each answered.
    r.after.enemyNextAttackAt = r.after.time + 0.5;
    const later = tick(r.after, 3, { loadout: () => [] });
    expect(later.cultivator.hp).toBe(r.after.cultivator.hp);
    expect(front(later).hp).toBe(
      1e6 - 2 * mitigate(r.d.damage * r.d.critMultiplier, front(r.s).defence),
    );
  });

  it('Ten Thousand Swords lands 6 hits, 8 at the upgrade, double on a low enemy', () => {
    const one = (r: ReturnType<typeof cast>) => mitigate(r.d.damage, front(r.s).defence);
    let r = cast('sword', 5, 'tenThousandSwords');
    expect(front(r.after).hp).toBe(1e6 - 6 * one(r));
    r = cast('sword', 8, 'tenThousandSwords');
    expect(front(r.after).hp).toBe(1e6 - 8 * one(r));
    const s = arena('sword', 8);
    front(s).hp = 2e5;
    r = cast('sword', 8, 'tenThousandSwords', s);
    expect(front(r.after).hp).toBe(2e5 - 8 * mitigate(r.d.damage * 2, front(s).defence));
  });

  it('Iron Skin raises defence, then reflects, then costs 20 qi', () => {
    let r = cast('body', 0, 'ironSkin');
    expect(r.after.combat.you.mods.slice(1)).toEqual([
      { stat: 'defence', amount: 0.6, until: r.when + 6, source: 'ironSkin' },
    ]);
    r = cast('body', 2, 'ironSkin');
    expect(r.after.combat.you).toMatchObject({ reflect: 0.25, reflectUntil: r.when + 6 });
    r = cast('body', 7, 'ironSkin');
    expect(r.after.cultivator.qi).toBe(Math.min(r.d.maxQi, r.d.maxQi - 20 + r.d.qiRegen));
  });

  it('Mountain Fist hits and stuns; the upgrade adds max HP; the Palm hits hardest', () => {
    let r = cast('body', 1, 'mountainFist');
    expect(front(r.after).hp).toBe(1e6 - mitigate(r.d.damage * 2, front(r.s).defence));
    expect(r.after.combat.foe.stunUntil).toBe(r.when + 1);
    r = cast('body', 4, 'mountainFist');
    expect(front(r.after).hp).toBe(
      1e6 - mitigate(r.d.damage * 2 + r.d.maxHp * 0.1, front(r.s).defence),
    );
    expect(r.after.combat.foe.stunUntil).toBe(r.when + 1.5);
    r = cast('body', 9, 'mountainFist');
    expect(front(r.after).hp).toBe(
      1e6 - mitigate(r.d.damage * 3 + r.d.maxHp * 0.15, front(r.s).defence),
    );
    expect(r.after.combat.foe.stunUntil).toBe(r.when + 1.5);
  });

  it('Blood Qi Surge heals a quarter, then doubles lifesteal', () => {
    const s = arena('body', 3);
    s.cultivator.hp = 10;
    let r = cast('body', 3, 'bloodQiSurge', s);
    expect(r.after.cultivator.hp).toBeGreaterThanOrEqual(10 + Math.round(r.d.maxHp * 0.25));
    r = cast('body', 6, 'bloodQiSurge');
    expect(r.after.combat.you.mods.slice(1)).toEqual([
      { stat: 'lifesteal', amount: r.d.lifesteal, until: r.when + 6, source: 'bloodQiSurge' },
    ]);
  });

  it('Vajra Body holds HP at 1 for 4 s (6 at the upgrade), then heals 10%', () => {
    let r = cast('body', 5, 'vajraBody');
    expect(r.after.combat.you).toMatchObject({ endureUntil: r.when + 4, endureHeal: 0.1 });
    r = cast('body', 8, 'vajraBody');
    expect(r.after.combat.you).toMatchObject({ endureUntil: r.when + 6, endureHeal: 0.1 });
    // A killing blow leaves 1 HP, and the end heals a tenth.
    const hard = r.after;
    front(hard).hp = 1e6;
    (hard.enemies[0] as { damage: number }).damage = 1e9;
    hard.enemyNextAttackAt = hard.time + 0.5;
    hard.qiNextAt = OFF;
    const held = tick(hard, 1, { loadout: () => [] });
    expect(held.cultivator.hp).toBe(1);
    hard.enemyNextAttackAt = OFF;
    const healed = tick(hard, r.when + 6 - hard.time + 0.01, { loadout: () => [] });
    expect(healed.cultivator.hp).toBe(
      Math.min(r.d.maxHp, hard.cultivator.hp + Math.round(r.d.maxHp * 0.1)),
    );
  });

  it('Fire Talisman hits and burns; burns stack at Nascent Soul; costs 20 at the top', () => {
    let r = cast('talisman', 0, 'fireTalisman', undefined, 6);
    const burn = mitigate((r.d.damage * 0.5) / 3, front(r.s).defence);
    expect(front(r.after).hp).toBe(1e6 - mitigate(r.d.damage * 2.2, front(r.s).defence) - 3 * burn);
    const twice = (realm: number) =>
      tick(arena('talisman', realm), 3, {
        loadout: (_s, side) =>
          side === 'you' ? [{ ...at('talisman', realm, 'fireTalisman'), when: () => true }] : [],
      }).combat.foe.burns.length;
    expect(twice(0)).toBe(1);
    expect(twice(3)).toBeGreaterThan(1);
    r = cast('talisman', 8, 'fireTalisman');
    expect(r.after.cultivator.qi).toBe(Math.min(r.d.maxQi, r.d.maxQi - 20 + r.d.qiRegen));
  });

  it('Thunder Talisman hits the next one, then the 3 next, then the whole wave at 200%', () => {
    const hits = (r: ReturnType<typeof cast>) => r.after.enemies.map((e) => 1e6 - e.hp);
    const m = (r: ReturnType<typeof cast>, mult: number) =>
      mitigate(r.d.damage * mult, front(r.s).defence);
    let r = cast('talisman', 1, 'thunderTalisman');
    expect(hits(r)).toEqual([m(r, 1.8), m(r, 0.9), 0, 0]);
    r = cast('talisman', 5, 'thunderTalisman');
    expect(hits(r)).toEqual([m(r, 1.8), m(r, 0.9), m(r, 0.9), m(r, 0.9)]);
    const s = arena('talisman', 9);
    for (let i = 0; i < 3; i++) s.enemies.push(structuredClone(s.enemies[1]!));
    s.enemies.push(makeTribulation(1, 8));
    r = cast('talisman', 9, 'thunderTalisman', s);
    const all = hits(r);
    expect(all).toHaveLength(8);
    expect(all.slice(0, 7)).toEqual(Array(7).fill(m(r, 2)));
    expect(r.after.enemies[7]?.kind).toBe('tribulation');
    expect(r.after.enemies[7]?.hp).toBe(s.enemies[7]?.hp);
  });

  it('Spirit Shield shields a fifth of max HP for 8 s; the upgrade bursts for its worth', () => {
    let r = cast('talisman', 2, 'spiritShield');
    const worth = Math.round(r.d.maxHp * 0.2);
    expect(r.after.combat.you).toMatchObject({
      shield: worth,
      shieldUntil: r.when + 8,
      shieldBurst: 0,
    });
    r = cast('talisman', 6, 'spiritShield');
    expect(r.after.combat.you.shieldBurst).toBe(Math.round(r.d.maxHp * 0.2));
  });

  it("Sealing Talisman empties the enemy's qi and silences it; the upgrade steals for 8 s", () => {
    let r = cast('talisman', 4, 'sealingTalisman');
    // The regen step at 2 s gives the enemy back 1.
    expect(front(r.after).qi).toBe(1);
    expect(r.after.combat.foe.silenceUntil).toBe(r.when + 5);
    const s = arena('talisman', 7);
    s.cultivator.qi = 50;
    r = cast('talisman', 7, 'sealingTalisman', s);
    expect(r.after.combat.foe.silenceUntil).toBe(r.when + 8);
    // A regen step before the cast and one after; the 60 stolen pays the 50 back.
    expect(r.after.cultivator.qi).toBe(Math.min(r.d.maxQi, 60 + 2 * r.d.qiRegen));
  });
});

describe('Path skill "uses it when" rules', () => {
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
    > = {},
  ): RuleInputs {
    const { self, other, ...ctx } = over;
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
      nextHitKills: false,
    };
  }

  /** Whether `def` may be cast alone, the shared rules included. */
  const may = (def: SkillDef, over: Parameters<typeof inputs>[0] = {}) =>
    usable(def, [def], inputs(over));

  it('Flying Sword: ready, unless Ten Thousand Swords is within 20 qi', () => {
    const loadout = pathSkills('sword', 5);
    const fs = at('sword', 5, 'flyingSword');
    expect(may(at('sword', 0, 'flyingSword'), { self: { qi: 30 } })).toBe(true);
    const low = { hp: 20 };
    expect(usable(fs, loadout, inputs({ self: { qi: 75 }, other: low }))).toBe(false);
    expect(usable(fs, loadout, inputs({ self: { qi: 65 }, other: low }))).toBe(true);
    // Only while Ten Thousand Swords would be cast: not on an elite above 30% HP,
    // nor a demon (rule 1 is for elites and tougher).
    expect(usable(fs, loadout, inputs({ self: { qi: 75 } }))).toBe(true);
    expect(usable(fs, loadout, inputs({ self: { qi: 75 }, other: low, foeKind: 'demon' }))).toBe(
      true,
    );
    expect(usable(fs, loadout, inputs({ self: { qi: 75 }, foeKind: 'boss' }))).toBe(false);
  });

  describe('rule 1 holds a cheap skill only for a bigger one that would be cast', () => {
    const qis = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => from + i);
    /** Whether `id` may be cast from `path`'s whole loadout in `realm`. */
    const free = (path: PathId, realm: number, id: string, over: Parameters<typeof inputs>[0]) =>
      usable(at(path, realm, id), pathSkills(path, realm), inputs(over));

    it('Flying Sword, at 30–44 qi: not for a Sword Intent that the enemy at 40% or a running buff stops', () => {
      for (const qi of qis(30, 44)) {
        expect(free('sword', 1, 'flyingSword', { self: { qi }, other: { hp: 40 } }), `${qi}`).toBe(
          true,
        );
        const r = inputs({ self: { qi } });
        r.status.mods.push({ stat: 'attackSpeed', amount: 0.4, until: 15, source: 'swordIntent' });
        expect(usable(at('sword', 1, 'flyingSword'), pathSkills('sword', 1), r), `${qi}`).toBe(
          true,
        );
        // A Sword Intent that would be cast still holds it.
        expect(free('sword', 1, 'flyingSword', { self: { qi } }), `${qi}`).toBe(false);
      }
    });

    it('Fire Talisman, at 30–44 qi: not for a Thunder Talisman with one enemy and no boss', () => {
      for (const qi of qis(30, 44)) {
        expect(free('talisman', 1, 'fireTalisman', { self: { qi }, reachable: 1 }), `${qi}`).toBe(
          true,
        );
        expect(free('talisman', 1, 'fireTalisman', { self: { qi }, reachable: 3 }), `${qi}`).toBe(
          false,
        );
      }
    });

    it('Fire Talisman, at 30–49 qi in Nascent Soul: not for a Spirit Shield at full HP', () => {
      for (const qi of qis(30, 49)) {
        expect(free('talisman', 3, 'fireTalisman', { self: { qi }, reachable: 1 }), `${qi}`).toBe(
          true,
        );
      }
      // Low on HP the shield would be cast, so it holds the talisman.
      expect(free('talisman', 3, 'fireTalisman', { self: { qi: 30, hp: 50 }, reachable: 1 })).toBe(
        false,
      );
    });

    it('Mountain Fist interrupts at 40–54 qi: not held for Blood Qi Surge at full HP', () => {
      for (const qi of qis(40, 54)) {
        expect(
          free('body', 5, 'mountainFist', { self: { qi }, other: { windingUp: true } }),
          `${qi}`,
        ).toBe(true);
      }
    });
  });

  it('Sword Intent: at fight start vs an elite or tougher, or the enemy above 50% HP', () => {
    const def = at('sword', 1, 'swordIntent');
    const low = { hp: 40 };
    expect(INTENT_HP_SHARE).toBe(0.5);
    expect(may(def, { other: low, self: { fightTime: 0.5 } })).toBe(true);
    expect(may(def, { other: low, self: { fightTime: 0.5 }, foeKind: 'demon' })).toBe(false);
    expect(may(def, { other: low })).toBe(false);
    expect(may(def, { other: { hp: 51 }, foeKind: 'demon' })).toBe(true);
    expect(may(def, { other: { hp: 50 }, foeKind: 'demon' })).toBe(false);
  });

  for (const [path, realm, id] of [
    ['sword', 3, 'lightningStep'],
    ['body', 0, 'ironSkin'],
  ] as const) {
    it(`${id}: when the enemy winds up, or HP is low (60%)`, () => {
      const def = at(path, realm, id);
      expect(may(def)).toBe(false);
      expect(may(def, { other: { windingUp: true } })).toBe(true);
      expect(may(def, { self: { hp: 60 } })).toBe(true);
      expect(may(def, { self: { hp: 61 } })).toBe(false);
    });
  }

  it('Lightning Step: not again while it still has dodges', () => {
    expect(may(at('sword', 3, 'lightningStep'), { self: { hp: 10, evades: 1 } })).toBe(false);
  });

  it('Ten Thousand Swords: vs an elite or tougher below 30% HP, or a boss', () => {
    const def = at('sword', 5, 'tenThousandSwords');
    expect(may(def, { other: { hp: 29 } })).toBe(true);
    expect(may(def, { other: { hp: 30 } })).toBe(false);
    expect(may(def, { other: { hp: 29 }, foeKind: 'demon' })).toBe(false);
    for (const kind of ['boss', 'tribulation'] as EnemyKind[]) {
      expect(may(def, { foeKind: kind })).toBe(true);
    }
  });

  it('Mountain Fist: to interrupt a wind-up, otherwise when qi is full', () => {
    const def = at('body', 1, 'mountainFist');
    expect(may(def, { self: { qi: 50 }, other: { windingUp: true } })).toBe(true);
    expect(may(def, { self: { qi: 100 } })).toBe(true);
    expect(may(def, { self: { qi: 99 } })).toBe(false);
  });

  it('Blood Qi Surge: HP below 40%', () => {
    const def = at('body', 3, 'bloodQiSurge');
    expect(SURGE_HP_SHARE).toBe(0.4);
    expect(may(def, { self: { hp: 39 } })).toBe(true);
    expect(may(def, { self: { hp: 40 } })).toBe(false);
    expect(may(def, { self: { hp: 90 }, other: { windingUp: true } })).toBe(false);
  });

  it('Vajra Body: a hit about to take HP below 20%, or a boss winding up', () => {
    const def = at('body', 5, 'vajraBody');
    expect(VAJRA_HP_SHARE).toBe(0.2);
    expect(may(def, { self: { hp: 50 }, incoming: 31 })).toBe(true);
    expect(may(def, { self: { hp: 50 }, incoming: 30 })).toBe(false);
    expect(may(def, { other: { windingUp: true }, foeKind: 'boss' })).toBe(true);
    expect(may(def, { other: { windingUp: true }, foeKind: 'tribulation' })).toBe(true);
    expect(may(def, { other: { windingUp: true }, foeKind: 'elite' })).toBe(false);
    // A one-shot from above 60% HP: cast, though shared rule 3 would wait.
    expect(may(def, { self: { hp: 90 }, incoming: 75 })).toBe(true);
    expect(may(def, { self: { hp: 90 }, incoming: 70 })).toBe(false);
  });

  it('Blood Qi Surge: a second heal is not held by the doubled lifesteal still running', () => {
    const r = inputs({ self: { hp: 30 } });
    r.status.mods.push({ stat: 'lifesteal', amount: 0.3, until: 15, source: 'bloodQiSurge' });
    const def = at('body', 6, 'bloodQiSurge');
    expect(usable(def, [def], r)).toBe(true);
  });

  it('Spirit Shield: cast again once broken, before its 8 s are up', () => {
    const def = at('talisman', 6, 'spiritShield');
    const r = inputs({ self: { hp: 50 } });
    r.status.shield = 10;
    r.status.shieldUntil = 17;
    expect(usable(def, [def], r)).toBe(false);
    r.status.shield = 0;
    expect(usable(def, [def], r)).toBe(true);
  });

  it("Fire Talisman: when the enemy isn't already burning, until burns stack", () => {
    expect(may(at('talisman', 0, 'fireTalisman'))).toBe(true);
    expect(may(at('talisman', 0, 'fireTalisman'), { other: { burning: true } })).toBe(false);
    expect(may(at('talisman', 3, 'fireTalisman'), { other: { burning: true } })).toBe(true);
  });

  it('Thunder Talisman: two or more enemies its spill can reach, or a boss', () => {
    const def = at('talisman', 1, 'thunderTalisman');
    expect(may(def, { reachable: 2 })).toBe(true);
    expect(may(def, { reachable: 1 })).toBe(false);
    // A Tribulation waiting at the end is left: it doesn't count.
    expect(may(def, { waveLeft: 2, reachable: 1 })).toBe(false);
    expect(may(def, { reachable: 1, foeKind: 'boss' })).toBe(true);
    expect(may(def, { reachable: 1, foeKind: 'tribulation' })).toBe(true);
  });

  it('Thunder Talisman in a fight: an elite with only a Tribulation behind it is not worth it', () => {
    const s = newGame(3, 'talisman');
    s.cultivator.level = realmLevels(1).from;
    const elite = makeEnemy(1, 'elite', 'Test Demon');
    elite.maxHp = elite.hp = 1e6;
    s.enemies = [elite, makeTribulation(1, 0)];
    s.cultivator.qi = 44;
    s.cultivator.nextAttackAt = OFF;
    s.enemyNextAttackAt = OFF;
    const names = (x: GameState) =>
      x.combat.log.flatMap((n) => ('skill' in n && n.who === 'you' ? [n.skill] : []));
    expect(names(tick(s, 3))).not.toContain('Thunder Talisman');
    s.enemies.splice(1, 0, makeEnemy(1, 'demon', 'Waiting Demon'));
    expect(names(tick(s, 3))).toContain('Thunder Talisman');
  });

  it('Spirit Shield: HP below 60%, or a wind-up', () => {
    const def = at('talisman', 2, 'spiritShield');
    expect(may(def, { self: { hp: 59 } })).toBe(true);
    expect(may(def, { self: { hp: 61 } })).toBe(false);
    expect(may(def, { other: { windingUp: true } })).toBe(true);
  });

  it('Sealing Talisman: an elite or tougher with qi above 70% of its own max', () => {
    const def = at('talisman', 4, 'sealingTalisman');
    expect(SEAL_QI_SHARE).toBe(0.7);
    expect(may(def, { other: { qi: 43, maxQi: 60 } })).toBe(true);
    expect(may(def, { other: { qi: 42, maxQi: 60 } })).toBe(false);
    expect(may(def, { other: { qi: 0, maxQi: 0 }, foeKind: 'demon' })).toBe(false);
    expect(may(def, { other: { qi: 150, maxQi: 150 }, foeKind: 'tribulation' })).toBe(true);
  });
});

describe('skills follow the Path and realm', () => {
  const ids = (s: GameState) => gameSkills(s, 'you').map((k) => k.id);

  it('the game casts the Path skills, and none for a regular demon', () => {
    const s = newGame(5, 'sword');
    expect(ids(s)).toEqual(['flyingSword']);
    expect(gameSkills(s, 'foe')).toEqual([]);
    // A plain tick plays them.
    const later = tick(s, 120);
    expect(later.combat.log.some((n) => 'skill' in n && n.skill === 'Flying Sword')).toBe(true);
  });

  it('learns the next one at a breakthrough', () => {
    const s = newGame(5, 'body');
    s.cultivator.level = 11;
    expect(ids(s)).toEqual(['ironSkin', 'mountainFist']);
  });

  it('a Path change swaps them at once, for the same realm', () => {
    const s = newGame(5, 'sword');
    s.cultivator.level = 45;
    s.stones = 1e9;
    const changed = changePath(s, 'talisman');
    expect(ids(changed)).toEqual(['fireTalisman', 'thunderTalisman', 'spiritShield']);
    expect(gameSkills(changed, 'you')).toBe(pathSkills('talisman', 3));
  });

  it('a Reincarnation starts again with the first skill only', () => {
    const s = newGame(5, 'body');
    s.cultivator.level = 150;
    s.highestFloor = s.floor = 40;
    expect(ids(s)).toHaveLength(4);
    expect(ids(retire(s))).toEqual(['ironSkin']);
  });
});
