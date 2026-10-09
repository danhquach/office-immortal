import { describe, expect, it } from 'vitest';
import { affixValue, EQUIP_SLOTS, type AffixId, type EquipSlotId, type Item } from './loot.ts';
import {
  BASE_STAT,
  derive,
  gainXp,
  MAX_CRIT_CHANCE,
  MAX_LIFESTEAL,
  MIN_ATTACK_INTERVAL,
  newCultivator,
  PATHS,
  STARTING_PRIMARY_BONUS,
  STAT_POINTS_PER_LEVEL,
  xpToNext,
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
