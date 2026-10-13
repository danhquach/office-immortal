import { describe, expect, it } from 'vitest';
import { affixValue, EQUIP_SLOTS, type AffixId, type EquipSlotId, type Item } from './loot.ts';
import {
  BASE_STAT,
  breakThrough,
  derive,
  effectiveStats,
  gainXp,
  isRealmCap,
  LAST_CAP,
  MAX_CRIT_CHANCE,
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
  REALMS,
  STARTING_PRIMARY_BONUS,
  STAT_POINTS_PER_LEVEL,
  xpToNext,
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

  it('caps crit chance', () => {
    const c = newCultivator('sword');
    c.stats.agility = 10_000;
    expect(derive(c).critChance).toBe(MAX_CRIT_CHANCE);
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

  // Each affix moves exactly the Derived field it names, by its value.
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
    const value = affixValue({ id, roll: 1 }, 10);
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
  it('grows with level', () => {
    for (let level = 1; level < 60; level++) {
      expect(xpToNext(level + 1)).toBeGreaterThan(xpToNext(level));
    }
  });
});

describe('gainXp', () => {
  it('levels up and puts the points on the primary stat', () => {
    const c = newCultivator('talisman');
    const before = { ...c.stats };
    gainXp(c, xpToNext(1));
    expect(c.level).toBe(2);
    expect(c.xp).toBe(0);
    expect(c.stats.spirit).toBe(before.spirit + STAT_POINTS_PER_LEVEL);
    expect(c.stats.body).toBe(before.body);
    expect(c.stats.agility).toBe(before.agility);
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
    expect([1, 10, 11, 22, 23, 52, 53, 90, 91, 162, 163, 500].map(realmOf)).toEqual([
      0, 0, 1, 1, 2, 3, 4, 5, 6, 8, 9, 9,
    ]);
  });

  it('caps at the end of each realm, each 2 levels longer, up to Tribulation Transcendence, then never', () => {
    const caps = Array.from({ length: 300 }, (_, i) => i + 1).filter(isRealmCap);
    expect(caps).toEqual([10, 22, 36, 52, 70, 90, 112, 136, 162]);
    expect(caps).toEqual(REALM_CAPS);
    expect(LAST_CAP).toBe(162);
    const lengths = REALM_CAPS.map((cap, i) => cap - (REALM_CAPS[i - 1] ?? 0));
    expect(lengths).toEqual([10, 12, 14, 16, 18, 20, 22, 24, 26]);
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
    const c = atLevel('body', 22);
    for (let i = 0; i < 50; i++) gainXp(c, 1e6);
    expect(c.level).toBe(22);
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
    const c = atLevel('sword', 162);
    c.xp = xpToNext(162);
    breakThrough(c);
    expect(c.level).toBe(163);
    gainXp(c, xpToNext(163) + xpToNext(164) + xpToNext(165));
    expect(c.level).toBe(166);
    expect(readyForTribulation({ ...c, level: 100, xp: 1e9 })).toBe(false);
  });
});

describe('breakThrough', () => {
  it('passes the cap and spends the held XP up to the next one', () => {
    const c = atLevel('sword', 10);
    let xp = 0;
    for (let l = 10; l < 22; l++) xp += xpToNext(l);
    c.xp = xp + xpToNext(22) + 9;
    breakThrough(c);
    expect(c.level).toBe(22);
    expect(c.xp).toBe(xpToNext(22) + 9);
    expect(readyForTribulation(c)).toBe(true);
  });

  it('applies the realm bonus once, on top of the level-up', () => {
    // Sword's primary is Agility, so the primary boost moves damage but not max HP.
    const held = atLevel('sword', 10);
    held.xp = xpToNext(10);
    // The same stats one realm lower: what level 11 would be without the realm
    // bonus, its +1% Agility already applied.
    const agility = (held.stats.agility + 3) * (1 + REALM_PRIMARY_STEP);
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
    // Held XP is clamped to MAX_SAFE_INTEGER, so each cap's price must fit under it.
    expect(xpToNext(LAST_CAP)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    for (const cap of REALM_CAPS) {
      expect(Number.isSafeInteger(xpToNext(cap))).toBe(true);
    }
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
    expect(at(22)).toBeCloseTo(0.01);
    expect(at(23)).toBeCloseTo(0.02625);
    expect(at(37)).toBeCloseTo(0.04875);
    expect(at(162)).toBeCloseTo(0.255);
    expect(at(163)).toBeCloseTo(0.315);
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
    const c = atLevel(path, 163);
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
    const c = atLevel('body', 163);
    const eff = effectiveStats(c);
    const d = derive(c);
    expect(d.maxHp).toBe(Math.round((40 + 12 * eff.body) * (1 + REALM_BONUS * 9)));
    expect(d.defence).toBe(eff.body);
  });
});
