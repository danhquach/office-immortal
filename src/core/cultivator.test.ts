import { describe, expect, it } from 'vitest';
import { affixValue, EQUIP_SLOTS, type AffixId, type EquipSlotId, type Item } from './loot.ts';
import { XP_GROWTH } from './floors.ts';
import {
  agilityAttacks,
  COOLDOWN_CURVE,
  CRIT_BASE,
  CRIT_CURVE,
  OFF_PATH_SHARE,
  pathShare,
  curve,
  DAMAGE_PER_MAIN,
  defaultRatio,
  DODGE_CURVE,
  FLOWING_SWORD_MIN_INTERVAL,
  IRON_BODY_LIFESTEAL,
  isCarry,
  isRatio,
  nextPlanStat,
  PIERCE_CURVE,
  REFLECT_CURVE,
  RESONANCE_SPLASH,
  slowsAt,
  STAT_IDS,
  type PlanSlot,
  type StatId,
  type Stats,
  LEVEL_XP_GROWTH,
  BASE_STAT,
  breakThrough,
  DEFENCE_PER_BODY,
  derive,
  effectiveStats,
  gainXp,
  HP_PER_BODY,
  isRealmCap,
  LAST_CAP,
  MAX_LIFESTEAL,
  MIN_ATTACK_INTERVAL,
  newCultivator,
  PATHS,
  readyForTribulation,
  REALM_BONUS,
  REALM_CAPS,
  REALM_PRIMARY_STEP,
  realmOf,
  realmPrimaryBonus,
  realmPrimaryShare,
  realmLevels,
  REALMS,
  STARTING_PRIMARY_BONUS,
  STAT_POINTS_PER_LEVEL,
  xpToNext,
  zeroCarry,
  type Cultivator,
  type Derived,
  type PathId,
} from './cultivator.ts';

const PATH_IDS = Object.keys(PATHS) as PathId[];

describe('newCultivator', () => {
  it.each(PATH_IDS)('starts %s at level 1, full HP, with a bonus on the primary stat', (path) => {
    const c = newCultivator(path);
    expect(c.level).toBe(1);
    expect(c.xp).toBe(0);
    expect(c.hp).toBe(derive(c).maxHp);
    for (const [stat, value] of Object.entries(c.stats)) {
      const bonus = stat === PATHS[path].primary ? STARTING_PRIMARY_BONUS : 0;
      expect(value).toBe(BASE_STAT + bonus);
    }
  });

  it('gives each Path a different primary stat', () => {
    expect(new Set(PATH_IDS.map((p) => PATHS[p].primary)).size).toBe(PATH_IDS.length);
  });
});

describe('derive', () => {
  it('turns Body into HP and defence, Agility into speed', () => {
    const c = newCultivator('sword');
    const base = derive(c);
    c.stats.body += 10;
    c.stats.agility += 10;
    const more = derive(c);
    expect(more.maxHp).toBeGreaterThan(base.maxHp);
    expect(more.defence).toBeGreaterThan(base.defence);
    expect(more.attackInterval).toBeLessThan(base.attackInterval);
    expect(more.critChance).toBeGreaterThan(base.critChance);
  });

  it('keeps crit chance a chance however much Agility and gear stack', () => {
    const c = newCultivator('sword');
    c.stats.agility = 1e9;
    c.equipment.accessory1 = withAffix('critChance', 1000);
    expect(derive(c).critChance).toBe(1);
  });

  function withAffix(id: AffixId, level: number): Item {
    return {
      slot: 'accessory',
      name: 'Azure Spirit Pendant',
      level,
      grade: 'spirit',
      baseRoll: 0,
      affixes: [{ id, roll: 1 }],
    };
  }

  // Each affix moves exactly the Derived field it names, by its value (Qi
  // regen's as a share of the qi pool, so in qi per second).
  const ADDS: [AffixId, keyof Derived][] = [
    ['critChance', 'critChance'],
    ['critDamage', 'critMultiplier'],
    ['lifesteal', 'lifesteal'],
    ['maxHp', 'maxHp'],
    ['defence', 'defence'],
    ['qiRegen', 'qiRegen'],
    ['stoneFind', 'stoneFind'],
    ['treasureFind', 'treasureFind'],
  ];

  it.each(ADDS)('adds the %s affix to %s and nothing else', (id, field) => {
    const c = newCultivator('body');
    const blank = withAffix(id, 10);
    blank.affixes = [];
    c.equipment.accessory1 = blank;
    const before = derive(c);
    c.equipment.accessory1 = withAffix(id, 10);
    const after = derive(c);
    const value = affixValue({ id, roll: 1 }, 10) * (id === 'qiRegen' ? derive(c).maxQi : 1);
    expect(value).toBeGreaterThan(0);
    for (const k of Object.keys(before) as (keyof Derived)[]) {
      expect(after[k]).toBeCloseTo(before[k] + (k === field ? value : 0), 9);
    }
  });

  it('speeds attacks with the attack speed affix', () => {
    const c = newCultivator('body');
    const before = derive(c).attackInterval;
    c.equipment.accessory1 = withAffix('attackSpeed', 10);
    const bonus = affixValue({ id: 'attackSpeed', roll: 1 }, 10);
    expect(1 / derive(c).attackInterval - 1 / before).toBeCloseTo(bonus, 9);
  });

  it('caps lifesteal and attack speed however much gear stacks', () => {
    const c = newCultivator('body');
    for (const [at, { takes }] of Object.entries(EQUIP_SLOTS)) {
      c.equipment[at as EquipSlotId] = {
        slot: takes,
        name: 'x',
        level: 1000,
        grade: 'immortal',
        baseRoll: 1,
        affixes: [
          { id: 'lifesteal', roll: 1 },
          { id: 'attackSpeed', roll: 1 },
        ],
        unique: 'overtime',
      };
    }
    expect(derive(c).lifesteal).toBe(MAX_LIFESTEAL);
    expect(derive(c).attackInterval).toBe(MIN_ATTACK_INTERVAL);
  });
});

describe('xpToNext', () => {
  it('starts at 50 and grows 1.15× a level, rounded', () => {
    expect([1, 2, 3, 10].map(xpToNext)).toEqual([50, 57, 66, 176]);
  });

  it("grows at the same rate as a kill's XP per floor", () => {
    expect(LEVEL_XP_GROWTH).toBe(XP_GROWTH);
  });

  it('grows with level', () => {
    for (let level = 1; level < 60; level++) {
      expect(xpToNext(level + 1)).toBeGreaterThan(xpToNext(level));
    }
  });
});

describe('gainXp', () => {
  it('levels up and leaves the points unspent without a plan', () => {
    const c = newCultivator('talisman');
    const before = { ...c.stats };
    gainXp(c, xpToNext(1));
    expect(c.level).toBe(2);
    expect(c.xp).toBe(0);
    expect(c.stats).toEqual(before);
    expect(c.unspent).toBe(STAT_POINTS_PER_LEVEL);
  });

  it('spends level-up points by the plan when one is given, healing the HP they add', () => {
    const c = newCultivator('talisman');
    const before = { ...c.stats };
    const plan = { ratio: { body: 100, agility: 0, spirit: 0 }, carry: zeroCarry() };
    gainXp(c, xpToNext(1), plan);
    expect(c.unspent).toBe(0);
    expect(c.stats).toEqual({ ...before, body: before.body + STAT_POINTS_PER_LEVEL });
    expect(c.hp).toBe(derive(c).maxHp);
  });

  it('applies several level-ups at once and keeps the remainder', () => {
    const c = newCultivator('sword');
    gainXp(c, xpToNext(1) + xpToNext(2) + 7);
    expect(c.level).toBe(3);
    expect(c.xp).toBe(7);
  });

  it('heals the max HP a level-up adds', () => {
    const c = newCultivator('body');
    c.hp = 10;
    const before = derive(c).maxHp;
    gainXp(c, xpToNext(1));
    expect(c.hp).toBe(10 + derive(c).maxHp - before);
  });

  it('does nothing below the threshold', () => {
    const c = newCultivator('body');
    gainXp(c, xpToNext(1) - 1);
    expect(c.level).toBe(1);
  });
});

/** A cultivator at `level` with no XP, its level-up points already on the primary stat. */
function atLevel(path: PathId, level: number): Cultivator {
  const c = newCultivator(path);
  c.level = level;
  c.stats[PATHS[path].primary] += STAT_POINTS_PER_LEVEL * (level - 1);
  c.hp = derive(c).maxHp;
  return c;
}

describe('realms', () => {
  it('maps levels to the realms of the design table', () => {
    expect(REALMS.map((r) => r.name)).toEqual([
      'Qi Condensation',
      'Foundation Establishment',
      'Golden Core',
      'Nascent Soul',
      'Spirit Transformation',
      'Void Refinement',
      'Body Integration',
      'Mahayana',
      'Tribulation Transcendence',
      'Immortal Ascension',
    ]);
    expect(
      [1, 10, 11, 20, 21, 40, 41, 60, 61, 80, 81, 110, 111, 140, 141, 170, 171, 210, 211, 500].map(
        realmOf,
      ),
    ).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9]);
  });

  it('caps at the end of each realm, on a multiple of 10 and never shorter than the last, up to Tribulation Transcendence, then never', () => {
    const caps = Array.from({ length: 300 }, (_, i) => i + 1).filter(isRealmCap);
    expect(caps).toEqual([10, 20, 40, 60, 80, 110, 140, 170, 210]);
    expect(caps).toEqual(REALM_CAPS);
    expect(LAST_CAP).toBe(210);
    const lengths = REALM_CAPS.map((cap, i) => cap - (REALM_CAPS[i - 1] ?? 0));
    expect(lengths).toEqual([10, 10, 20, 20, 20, 30, 30, 30, 40]);
    expect(REALMS.map((_, i) => realmLevels(i))).toEqual([
      { from: 1, to: 10 },
      { from: 11, to: 20 },
      { from: 21, to: 40 },
      { from: 41, to: 60 },
      { from: 61, to: 80 },
      { from: 81, to: 110 },
      { from: 111, to: 140 },
      { from: 141, to: 170 },
      { from: 171, to: 210 },
      { from: 211, to: null },
    ]);
  });
});

describe('realm caps', () => {
  it('stops at level 10 and holds the XP past the cap', () => {
    const c = atLevel('sword', 9);
    gainXp(c, xpToNext(9) + xpToNext(10) + xpToNext(11) + 5);
    expect(c.level).toBe(10);
    expect(c.xp).toBe(xpToNext(10) + xpToNext(11) + 5);
    expect(readyForTribulation(c)).toBe(true);
  });

  it('keeps holding however much XP comes in', () => {
    const c = atLevel('body', 40);
    for (let i = 0; i < 50; i++) gainXp(c, 1e6);
    expect(c.level).toBe(40);
    expect(c.xp).toBe(5e7);
  });

  it('is not ready at the cap until the next level is paid for', () => {
    const c = atLevel('talisman', 10);
    gainXp(c, xpToNext(10) - 1);
    expect(readyForTribulation(c)).toBe(false);
    gainXp(c, 1);
    expect(readyForTribulation(c)).toBe(true);
  });

  it('never caps after Immortal Ascension', () => {
    const c = atLevel('sword', 210);
    c.xp = xpToNext(210);
    breakThrough(c);
    expect(c.level).toBe(211);
    gainXp(c, xpToNext(211) + xpToNext(212) + xpToNext(213));
    expect(c.level).toBe(214);
    // Immortal Ascension has no cap, so nothing is ever held there.
    expect(Array.from({ length: 90 }, (_, i) => 211 + i).some(isRealmCap)).toBe(false);
    expect(readyForTribulation({ ...c, xp: Number.MAX_SAFE_INTEGER })).toBe(false);
  });
});

describe('breakThrough', () => {
  it('passes the cap and spends the held XP up to the next one', () => {
    const c = atLevel('sword', 10);
    let xp = 0;
    for (let l = 10; l < 20; l++) xp += xpToNext(l);
    c.xp = xp + xpToNext(20) + 9;
    breakThrough(c);
    expect(c.level).toBe(20);
    expect(c.xp).toBe(xpToNext(20) + 9);
    expect(readyForTribulation(c)).toBe(true);
  });

  it('applies the realm bonus once, on top of the level-up', () => {
    // Sword's primary is Agility, so the primary boost moves damage but not max HP.
    const held = atLevel('sword', 10);
    held.xp = xpToNext(10);
    // The same stats one realm lower: what level 11 would be without the realm
    // bonus, its +1% Agility already applied.
    const agility = held.stats.agility * (1 + REALM_PRIMARY_STEP);
    const noBonus = derive({ ...held, stats: { ...held.stats, agility } });
    breakThrough(held);
    const after = derive(held);
    expect(after.maxHp).toBe(Math.round(noBonus.maxHp * (1 + REALM_BONUS)));
    expect(after.damage).toBeCloseTo(noBonus.damage * (1 + REALM_BONUS));
    // Fully healed, bonus included.
    expect(held.hp).toBe(after.maxHp);
    // More XP and levels in the same realm add no more realm bonus.
    gainXp(held, xpToNext(11));
    expect(held.level).toBe(12);
    const sameRealm = derive({ ...held, level: 11 });
    expect(derive(held)).toEqual(sameRealm);
  });

  it('stays finite and short from the last cap with the most XP a save can hold', () => {
    const c = atLevel('sword', LAST_CAP);
    c.xp = Number.MAX_SAFE_INTEGER;
    breakThrough(c);
    expect(c.level).toBeGreaterThan(LAST_CAP);
    expect(c.level).toBeLessThan(300);
    const d = derive(c);
    expect(Number.isFinite(d.maxHp) && Number.isFinite(d.damage)).toBe(true);
  });

  it("keeps every cap's XP to the next level within what a save can hold", () => {
    // Held XP is clamped to MAX_SAFE_INTEGER, so a cap's price must fit under it
    // for its Tribulation to fall due, and Immortal Ascension keeps levelling past it.
    for (const cap of REALM_CAPS) expect(Number.isSafeInteger(xpToNext(cap))).toBe(true);
    expect(xpToNext(LAST_CAP + 20)).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('never holds more XP than a whole number can store', () => {
    const c = atLevel('body', 10);
    c.xp = Number.MAX_SAFE_INTEGER;
    gainXp(c, 1e6);
    expect(c.xp).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('refuses below the cap, at the cap without the XP, and past the last cap', () => {
    expect(() => breakThrough(atLevel('sword', 9))).toThrow(RangeError);
    const c = atLevel('sword', 10);
    c.xp = xpToNext(10) - 1;
    expect(() => breakThrough(c)).toThrow(RangeError);
    const immortal = atLevel('sword', 61);
    immortal.xp = 0;
    expect(() => breakThrough(immortal)).toThrow(RangeError);
  });
});

describe('realm primary stat bonus', () => {
  it('adds 1% for realm 1, steps evenly up to 6% for the last, cumulative', () => {
    const at = (level: number) => realmPrimaryBonus(level);
    expect(at(10)).toBe(0);
    expect(at(11)).toBeCloseTo(0.01);
    expect(at(20)).toBeCloseTo(0.01);
    expect(at(21)).toBeCloseTo(0.02625);
    expect(at(41)).toBeCloseTo(0.04875);
    expect(at(210)).toBeCloseTo(0.255);
    expect(at(211)).toBeCloseTo(0.315);
    expect(at(5000)).toBeCloseTo(0.315);
  });

  it('gives a bigger step at every harder realm', () => {
    const steps = REALMS.map((_, r) => realmPrimaryShare(r + 1) - realmPrimaryShare(r)).slice(
      0,
      -1,
    );
    for (let r = 1; r < steps.length; r++) {
      expect(steps[r] as number).toBeGreaterThan(steps[r - 1] as number);
      // Spread evenly: the same rise every realm.
      expect((steps[r] as number) - (steps[r - 1] as number)).toBeCloseTo(0.00625);
    }
    expect(steps[0]).toBeCloseTo(0.01);
    expect(steps.at(-1)).toBeCloseTo(0.06);
  });

  it.each(PATH_IDS)('raises only the primary stat of %s', (path) => {
    const c = atLevel(path, 211);
    const eff = effectiveStats(c);
    const primary = PATHS[path].primary;
    for (const stat of ['body', 'agility', 'spirit'] as const) {
      if (stat === primary) {
        expect(eff[stat]).toBeCloseTo(c.stats[stat] * 1.315);
        expect(eff[stat]).toBeGreaterThan(c.stats[stat]);
      } else expect(eff[stat]).toBe(c.stats[stat]);
    }
  });

  it('counts a step too small to make a whole point', () => {
    // Foundation Establishment's +1% of a 40-point stat is 0.4: it still adds damage.
    const c = atLevel('sword', 11);
    c.stats.agility = 40;
    expect(effectiveStats(c).agility).toBeCloseTo(40.4);
    expect(derive(c).damage).toBeGreaterThan(
      derive({ ...c, level: 10 }).damage * (1 + REALM_BONUS) - 1e-9,
    );
  });

  it('does not change the stored stats, and is the plain stats in the first realm', () => {
    const c = atLevel('sword', 60);
    const before = structuredClone(c.stats);
    effectiveStats(c);
    expect(c.stats).toEqual(before);
    const first = atLevel('sword', 10);
    expect(effectiveStats(first)).toEqual(first.stats);
  });

  it('raises damage at a breakthrough by the realm bonus and the primary boost together', () => {
    const held = atLevel('sword', 10);
    const primary = PATHS.sword.primary;
    held.stats[primary] = 1000;
    held.xp = xpToNext(10);
    breakThrough(held);
    // The same stats and gear one realm lower: no realm bonus, no primary boost.
    const plain = derive({ ...held, level: 10 });
    const after = derive(held);
    const boost = Math.round(held.stats[primary] * 1.01) / held.stats[primary];
    expect(boost).toBeGreaterThan(1);
    const expected =
      ((4 + 1.5 * held.stats[primary] * boost) / (4 + 1.5 * held.stats[primary])) *
      (1 + REALM_BONUS);
    expect(after.damage / plain.damage).toBeCloseTo(expected);
    expect(after.damage / plain.damage).toBeGreaterThan(1 + REALM_BONUS);
  });

  it('feeds derive: the max HP and defence of a Body path use the boosted stat', () => {
    const c = atLevel('body', 211);
    const eff = effectiveStats(c);
    const d = derive(c);
    expect(d.maxHp).toBe(Math.round((40 + HP_PER_BODY * eff.body) * (1 + REALM_BONUS * 9)));
    expect(d.defence).toBe(DEFENCE_PER_BODY * eff.body);
  });
});

describe('stat curves (docs/design.md §3)', () => {
  /** A level 1 cultivator of `path` with `stat` at `points`, the others at the base. */
  function at(path: PathId, stat: StatId, points: number): Derived {
    const c = newCultivator(path);
    c.stats = { body: BASE_STAT, agility: BASE_STAT, spirit: BASE_STAT, [stat]: points };
    return derive(c);
  }
  const POINTS = [0, 100, 300, 1000] as const;

  it.each([
    [0, 1],
    [100, 1.75],
    [300, 2.5],
    [1000, 3.5946],
  ])('gives %i Agility %f attacks a second, full for a Sword Cultivator', (points, attacks) => {
    expect(agilityAttacks(points)).toBeCloseTo(attacks, 3);
    expect(1 / at('sword', 'agility', points).attackInterval).toBeCloseTo(attacks, 3);
    // Half the gain over 1 attack a second for the other Paths.
    for (const path of ['body', 'talisman'] as const) {
      expect(1 / at(path, 'agility', points).attackInterval).toBeCloseTo(1 + (attacks - 1) / 2, 3);
    }
  });

  it.each([
    ['critChance', 'agility', 'sword', [0.05, 0.23, 0.35, 0.4413]],
    ['dodge', 'agility', 'sword', [0, 0.05, 0.11, 0.1897]],
    ['cooldownReduction', 'agility', 'sword', [0, 0.1429, 0.2727, 0.4]],
    ['pierce', 'spirit', 'talisman', [0, 0.1702, 0.3, 0.4093]],
    ['hpRegen', 'body', 'body', [0, 10, 30, 100]],
  ] as const)(
    'gives %s from %s at 0, 100, 300 and 1000 points: full on its Path, half on the others',
    (field, stat, own, want) => {
      // Crit chance has a base the share doesn't touch.
      const base = field === 'critChance' ? CRIT_BASE : 0;
      for (const path of PATH_IDS) {
        const share = path === own ? 1 : OFF_PATH_SHARE;
        POINTS.forEach((p, i) => {
          const full = want[i] as number;
          expect(at(path, stat, p)[field]).toBeCloseTo(base + (full - base) * share, 4);
        });
      }
    },
  );

  it('gives +10 max HP and +0.5 defence per Body point to a Body Refiner, half to the others', () => {
    for (const path of PATH_IDS) {
      const share = path === 'body' ? 1 : OFF_PATH_SHARE;
      expect(pathShare(path, 'body')).toBe(share);
      for (const p of POINTS) {
        const d = at(path, 'body', p);
        expect(d.maxHp).toBe(Math.round(40 + HP_PER_BODY * share * p));
        expect(d.defence).toBeCloseTo(DEFENCE_PER_BODY * share * p, 9);
      }
    }
  });

  it('gives qi from Spirit by the same Path share', () => {
    for (const path of PATH_IDS) expect(PATHS[path].qiFromSpirit).toBe(pathShare(path, 'spirit'));
  });

  it('gives each Path the full share of its main stat and half of the others', () => {
    for (const path of PATH_IDS) {
      for (const stat of STAT_IDS) {
        expect(pathShare(path, stat)).toBe(stat === PATHS[path].primary ? 1 : 0.5);
      }
    }
  });

  it('adds damage only for the Path main stat, +1.5 a point', () => {
    for (const path of PATH_IDS) {
      for (const stat of STAT_IDS) {
        const gain = at(path, stat, 101).damage - at(path, stat, 100).damage;
        expect(gain).toBeCloseTo(stat === PATHS[path].primary ? DAMAGE_PER_MAIN : 0, 9);
      }
    }
  });

  it('has no limit of its own on any curve: each still grows past 1000 points', () => {
    for (const p of [1000, 10_000, 1e6]) {
      expect(agilityAttacks(p * 10)).toBeGreaterThan(agilityAttacks(p));
      for (const c of [CRIT_CURVE, DODGE_CURVE, PIERCE_CURVE, REFLECT_CURVE, COOLDOWN_CURVE]) {
        expect(curve(c, p * 10)).toBeGreaterThan(curve(c, p));
        expect(curve(c, p * 10)).toBeLessThan(c.max);
      }
    }
  });

  it('says where each curve slows to half its first gains', () => {
    for (const c of [CRIT_CURVE, DODGE_CURVE, PIERCE_CURVE, REFLECT_CURVE]) {
      const first = curve(c, 1) - curve(c, 0);
      const n = slowsAt(c);
      const there = curve(c, n + 1) - curve(c, n);
      expect(there / first).toBeCloseTo(0.5, 1);
    }
  });
});

describe('Path Mastery', () => {
  function at(path: PathId, stat: StatId, points: number): Derived {
    const c = newCultivator(path);
    c.stats = { body: BASE_STAT, agility: BASE_STAT, spirit: BASE_STAT, [stat]: points };
    return derive(c);
  }

  it('Flowing Sword: +0.5% crit damage per Agility point, for a Sword Cultivator only', () => {
    expect(at('sword', 'agility', 100).critMultiplier).toBeCloseTo(2 + 0.5, 9);
    expect(at('sword', 'agility', 300).critMultiplier).toBeCloseTo(2 + 1.5, 9);
    expect(at('body', 'agility', 300).critMultiplier).toBe(PATHS.body.critMultiplier);
    expect(at('talisman', 'agility', 300).critMultiplier).toBe(PATHS.talisman.critMultiplier);
  });

  it('Flowing Sword: attacks reach 5 a second; every other Path stops at 4', () => {
    expect(1 / at('sword', 'agility', 1e9).attackInterval).toBeCloseTo(5, 9);
    expect(FLOWING_SWORD_MIN_INTERVAL).toBe(0.2);
    expect(1 / at('body', 'agility', 1e9).attackInterval).toBeCloseTo(1 / MIN_ATTACK_INTERVAL, 9);
    expect(1 / at('talisman', 'agility', 1e9).attackInterval).toBeCloseTo(4, 9);
  });

  it.each([
    [0, 0],
    [100, 0.0899],
    [300, 0.186],
    [1000, 0.2974],
  ])('Iron Body: reflects at %i Body %f of damage taken, for a Body Refiner only', (p, want) => {
    expect(at('body', 'body', p).reflect).toBeCloseTo(want, 4);
    expect(at('sword', 'body', p).reflect).toBe(0);
    expect(at('talisman', 'body', p).reflect).toBe(0);
  });

  it('Iron Body: a little lifesteal per Body point, within the lifesteal cap', () => {
    expect(at('body', 'body', 100).lifesteal).toBeCloseTo(
      PATHS.body.lifesteal + IRON_BODY_LIFESTEAL * 100,
      9,
    );
    expect(at('sword', 'body', 100).lifesteal).toBe(PATHS.sword.lifesteal);
    expect(at('body', 'body', 1e6).lifesteal).toBe(MAX_LIFESTEAL);
  });

  it('Talisman Resonance: +1% burst damage per Spirit point and a 50% splash, Talisman only', () => {
    const burst = PATHS.talisman.burstMultiplier;
    expect(at('talisman', 'spirit', 100).burstMultiplier).toBeCloseTo(burst * 2, 9);
    expect(at('talisman', 'spirit', 300).burstMultiplier).toBeCloseTo(burst * 4, 9);
    expect(at('talisman', 'spirit', 100).splash).toBe(RESONANCE_SPLASH);
    expect(at('sword', 'spirit', 300)).toMatchObject({ burstMultiplier: 1, splash: 0 });
    expect(at('body', 'spirit', 300)).toMatchObject({ burstMultiplier: 1, splash: 0 });
  });
});

describe('Auto-assign plan', () => {
  const RATIOS: Stats[] = [
    { body: 100, agility: 0, spirit: 0 },
    { body: 33, agility: 33, spirit: 34 },
    { body: 30, agility: 60, spirit: 10 },
    { body: 1, agility: 98, spirit: 1 },
    { body: 0, agility: 49, spirit: 51 },
  ];

  /** Levels `c` up `levels` times with `plan`, winning each Tribulation on the way. */
  function levelUp(c: Cultivator, plan: PlanSlot, levels: number): void {
    const target = c.level + levels;
    while (c.level < target) {
      if (isRealmCap(c.level)) {
        c.xp = xpToNext(c.level);
        breakThrough(c, plan);
      } else {
        gainXp(c, xpToNext(c.level) - c.xp, plan);
      }
    }
  }

  it.each(RATIOS)('splits 100 levels of points exactly by the ratio %o', (ratio) => {
    const c = newCultivator('sword');
    const start = { ...c.stats };
    const plan = { ratio, carry: zeroCarry() };
    levelUp(c, plan, 100);
    expect(c.unspent).toBe(0);
    for (const id of STAT_IDS) expect(c.stats[id] - start[id]).toBe(3 * ratio[id]);
    expect(plan.carry).toEqual(zeroCarry());
  });

  it.each(RATIOS)('never strays a point from the ratio %o on the way', (ratio) => {
    const plan = { ratio, carry: zeroCarry() };
    const got = zeroCarry();
    for (let n = 1; n <= 250; n++) {
      got[nextPlanStat(plan)] += 1;
      for (const id of STAT_IDS) expect(Math.abs(got[id] - (n * ratio[id]) / 100)).toBeLessThan(1);
      expect(isCarry(plan.carry)).toBe(true);
    }
  });

  it('starts each Path at 100% of its main stat', () => {
    for (const path of PATH_IDS) {
      const r = defaultRatio(path);
      expect(isRatio(r)).toBe(true);
      expect(r[PATHS[path].primary]).toBe(100);
    }
  });

  const r = (o: Record<string, unknown>) => ({ body: 34, agility: 33, spirit: 33, ...o });
  it.each([
    ['negative', r({ body: -1, agility: 68 })],
    ['fractional', r({ body: 33.5, agility: 33.5 })],
    ['huge', r({ body: 1e300, agility: -1e300 + 66 })],
    ['over 100', r({ body: 200, agility: -100, spirit: 0 })],
    ['NaN', r({ body: NaN })],
    ['Infinity', r({ body: Infinity })],
    ['text', r({ body: '34' })],
    ['null value', r({ body: null })],
    ['not adding to 100', r({ body: 34, agility: 33, spirit: 32 })],
    ['an extra key', r({ qi: 0 })],
    ['a missing key', { body: 50, agility: 50 }],
    ['a prototype key', JSON.parse('{"body":34,"agility":33,"spirit":33,"__proto__":{"x":1}}')],
    ['a constructor key', r({ constructor: 0 })],
    ['an array', [34, 33, 33]],
    ['null', null],
    ['a number', 100],
    ['text', '{"body":100,"agility":0,"spirit":0}'],
    ['a null-prototype object', Object.assign(Object.create(null), r({}))],
  ])('refuses a ratio with %s', (_, v) => {
    expect(isRatio(v)).toBe(false);
  });

  it('accepts whole numbers from 0 to 100 adding up to 100', () => {
    expect(isRatio({ body: 34, agility: 33, spirit: 33 })).toBe(true);
    expect(isRatio({ body: 0, agility: 0, spirit: 100 })).toBe(true);
  });

  it.each([
    ['not adding to 0', { body: 1, agility: 0, spirit: 0 }],
    ['out of range', { body: 100, agility: -100, spirit: 0 }],
    ['fractional', { body: 0.5, agility: -0.5, spirit: 0 }],
    ['an extra key', { body: 0, agility: 0, spirit: 0, x: 0 }],
  ])('refuses a carry %s', (_, v) => {
    expect(isCarry(v)).toBe(false);
  });
});
