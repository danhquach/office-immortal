import { describe, expect, it } from 'vitest';
import { affixValue, EQUIP_SLOTS, type AffixId, type EquipSlotId, type Item } from './loot.ts';
import {
  BASE_STAT,
  breakThrough,
  derive,
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
  realmOf,
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
      name: 'Lanyard Pendant',
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
      'Spirit Severing',
      'Immortal Ascension',
      'Immortal',
    ]);
    expect([1, 10, 11, 20, 21, 50, 51, 60, 61, 500].map(realmOf)).toEqual([
      0, 0, 1, 1, 2, 4, 5, 5, 6, 6,
    ]);
  });

  it('caps every 10 levels up to Immortal Ascension, then never', () => {
    const caps = Array.from({ length: 200 }, (_, i) => i + 1).filter(isRealmCap);
    expect(caps).toEqual([10, 20, 30, 40, 50, 60]);
    expect(LAST_CAP).toBe(60);
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
    const c = atLevel('body', 20);
    for (let i = 0; i < 50; i++) gainXp(c, 1e6);
    expect(c.level).toBe(20);
    expect(c.xp).toBe(5e7);
  });

  it('is not ready at the cap until the next level is paid for', () => {
    const c = atLevel('talisman', 10);
    gainXp(c, xpToNext(10) - 1);
    expect(readyForTribulation(c)).toBe(false);
    gainXp(c, 1);
    expect(readyForTribulation(c)).toBe(true);
  });

  it('never caps an Immortal', () => {
    const c = atLevel('sword', 60);
    c.xp = xpToNext(60);
    breakThrough(c);
    expect(c.level).toBe(61);
    gainXp(c, xpToNext(61) + xpToNext(62) + xpToNext(63));
    expect(c.level).toBe(64);
    expect(readyForTribulation({ ...c, level: 70, xp: 1e9 })).toBe(false);
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
    const held = atLevel('body', 10);
    held.xp = xpToNext(10);
    // The same stats one realm lower: what level 11 would be without the bonus.
    const noBonus = derive({ ...held, stats: { ...held.stats, body: held.stats.body + 3 } });
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
