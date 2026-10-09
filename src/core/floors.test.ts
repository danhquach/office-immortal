import { describe, expect, it } from 'vitest';
import {
  BOSSES,
  DEMONS,
  DEMONS_PER_WAVE,
  makeEnemy,
  makeFloor,
  WAVES_PER_FLOOR,
} from './floors.ts';
import { createRng } from './rng.ts';

describe('makeFloor', () => {
  it('lines up the waves, then an elite, then a boss', () => {
    const enemies = makeFloor(createRng(1), 1);
    const demons = WAVES_PER_FLOOR * DEMONS_PER_WAVE;
    expect(enemies).toHaveLength(demons + 2);
    expect(enemies.slice(0, demons).every((e) => e.kind === 'demon')).toBe(true);
    expect(enemies[demons]?.kind).toBe('elite');
    expect(enemies[demons + 1]?.kind).toBe('boss');
  });

  it('uses the named office demons and bosses', () => {
    const names = new Set<string>(DEMONS);
    for (const e of makeFloor(createRng(2), 5)) {
      if (e.kind === 'demon') expect(names.has(e.name)).toBe(true);
      if (e.kind === 'elite') expect(names.has(e.name.replace(/^Elite /, ''))).toBe(true);
      if (e.kind === 'boss') expect(BOSSES).toContain(e.name);
    }
  });

  it('replays the same floor from the same seed', () => {
    expect(makeFloor(createRng(9), 3)).toEqual(makeFloor(createRng(9), 3));
  });

  it('starts every enemy at full HP', () => {
    for (const e of makeFloor(createRng(3), 7)) expect(e.hp).toBe(e.maxHp);
  });
});

describe('makeEnemy', () => {
  it('gets stronger and worth more every floor', () => {
    for (let floor = 1; floor < 50; floor++) {
      const a = makeEnemy(floor, 'demon', 'x');
      const b = makeEnemy(floor + 1, 'demon', 'x');
      expect(b.maxHp).toBeGreaterThan(a.maxHp);
      expect(b.damage).toBeGreaterThan(a.damage);
      expect(b.xp).toBeGreaterThanOrEqual(a.xp);
    }
  });

  it('makes elites tougher than demons and bosses tougher than elites', () => {
    const demon = makeEnemy(4, 'demon', 'x');
    const elite = makeEnemy(4, 'elite', 'x');
    const boss = makeEnemy(4, 'boss', 'x');
    expect(elite.maxHp).toBeGreaterThan(demon.maxHp);
    expect(boss.maxHp).toBeGreaterThan(elite.maxHp);
    expect(boss.xp).toBeGreaterThan(elite.xp);
  });
});
