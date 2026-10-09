import { describe, expect, it } from 'vitest';
import {
  BASE_STAT,
  derive,
  gainXp,
  MAX_CRIT_CHANCE,
  newCultivator,
  PATHS,
  STARTING_PRIMARY_BONUS,
  STAT_POINTS_PER_LEVEL,
  xpToNext,
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
