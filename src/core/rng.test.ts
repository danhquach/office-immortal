import { describe, expect, it } from 'vitest';
import { chance, createRng, int, pick } from './rng.ts';

describe('createRng', () => {
  it('replays the same sequence from the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 5 }, a)).toEqual(Array.from({ length: 5 }, b));
  });

  it('gives different sequences for different seeds', () => {
    expect(createRng(1)()).not.toBe(createRng(2)());
  });

  it('stays within [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('int', () => {
  it('replays the same rolls from the same seed', () => {
    const a = createRng(9);
    const b = createRng(9);
    const roll = (rng: typeof a) => Array.from({ length: 20 }, () => int(rng, 1, 6));
    expect(roll(a)).toEqual(roll(b));
  });

  it('includes both bounds and nothing outside them', () => {
    const rng = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i++) seen.add(int(rng, -2, 2));
    expect([...seen].sort((x, y) => x - y)).toEqual([-2, -1, 0, 1, 2]);
  });

  it('returns min when min equals max', () => {
    expect(int(createRng(1), 4, 4)).toBe(4);
  });

  it('reaches max when the source is just below 1', () => {
    expect(int(() => 0.999999999, 1, 6)).toBe(6);
    expect(int(() => 0, 1, 6)).toBe(1);
  });

  it('rejects inverted or fractional bounds', () => {
    const rng = createRng(1);
    expect(() => int(rng, 5, 1)).toThrow(RangeError);
    expect(() => int(rng, 0.5, 2)).toThrow(RangeError);
    expect(() => int(rng, 0, Number.NaN)).toThrow(RangeError);
  });
});

describe('pick', () => {
  it('replays the same picks from the same seed', () => {
    const list = ['a', 'b', 'c', 'd'];
    const a = createRng(11);
    const b = createRng(11);
    const run = (rng: typeof a) => Array.from({ length: 20 }, () => pick(rng, list));
    expect(run(a)).toEqual(run(b));
  });

  it('never returns undefined and reaches every item', () => {
    const list = [0, 1, 2];
    const rng = createRng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i++) {
      const v = pick(rng, list);
      expect(v).not.toBeUndefined();
      seen.add(v);
    }
    expect(seen).toEqual(new Set(list));
  });

  it('returns the only item of a one-item list', () => {
    expect(pick(createRng(1), ['x'])).toBe('x');
  });

  it('rejects an empty list', () => {
    expect(() => pick(createRng(1), [])).toThrow(RangeError);
  });
});

describe('chance', () => {
  it('replays the same results from the same seed', () => {
    const a = createRng(13);
    const b = createRng(13);
    const run = (rng: typeof a) => Array.from({ length: 20 }, () => chance(rng, 0.5));
    expect(run(a)).toEqual(run(b));
  });

  it('never fires at 0 and always fires at 1', () => {
    const rng = createRng(17);
    for (let i = 0; i < 1_000; i++) {
      expect(chance(rng, 0)).toBe(false);
      expect(chance(rng, 1)).toBe(true);
    }
  });

  it('fires about p of the time', () => {
    const rng = createRng(21);
    let hits = 0;
    for (let i = 0; i < 10_000; i++) if (chance(rng, 0.6)) hits++;
    expect(hits / 10_000).toBeCloseTo(0.6, 1);
  });
});
