import { describe, expect, it } from 'vitest';
import { PATHS, type PathId } from './cultivator.ts';
import { mitigate, newGame, tick, type GameState } from './sim.ts';

const PATH_IDS = Object.keys(PATHS) as PathId[];

function run(state: GameState, seconds: number, step: number): GameState {
  const steps = Math.round(seconds / step);
  for (let i = 0; i < steps; i++) state = tick(state, step);
  return state;
}

describe('determinism', () => {
  it.each(PATH_IDS)('replays %s the same from the same seed', (path) => {
    expect(run(newGame(42, path), 600, 1)).toEqual(run(newGame(42, path), 600, 1));
  });

  it('plays differently from a different seed', () => {
    expect(run(newGame(1, 'sword'), 600, 1)).not.toEqual(run(newGame(2, 'sword'), 600, 1));
  });
});

describe('tick', () => {
  it.each(PATH_IDS)('gives %s the same result for one big step as many small ones', (path) => {
    const start = newGame(7, path);
    const big = tick(start, 3600);
    const small = run(start, 3600, 1);
    expect(big).toEqual(small);
    // A fractional step lands on the same events too.
    expect(run(start, 3600, 0.25)).toEqual(big);
  });

  it('matches one big step within tolerance for a step that is not exact in binary', () => {
    const start = newGame(7, 'sword');
    const big = tick(start, 3600);
    const small = run(start, 3600, 0.1);
    // Summing 0.1s drifts the clock by a hair; every event still lands the same.
    expect(small.time).toBeCloseTo(big.time, 6);
    expect({ ...small, time: 0 }).toEqual({ ...big, time: 0 });
  });

  it('resumes from a saved copy exactly as if it never stopped', () => {
    const half = run(newGame(4, 'talisman'), 600, 1);
    const saved = JSON.parse(JSON.stringify(half)) as GameState;
    expect(tick(saved, 600)).toEqual(tick(half, 600));
  });

  it('leaves the input state untouched', () => {
    const start = newGame(3, 'body');
    const copy = structuredClone(start);
    tick(start, 120);
    expect(start).toEqual(copy);
  });

  it('changes nothing for dt 0', () => {
    const start = newGame(3, 'body');
    expect(tick(start, 0)).toEqual(start);
  });

  it('rejects negative, NaN and infinite dt', () => {
    const start = newGame(3, 'body');
    for (const dt of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => tick(start, dt)).toThrow(RangeError);
    }
  });
});

describe('floors', () => {
  it.each(PATH_IDS)('lets a fresh %s clear floor 1', (path) => {
    const s = run(newGame(11, path), 120, 1);
    expect(s.highestFloor).toBeGreaterThan(1);
  });

  it.each(PATH_IDS)('walls %s at a higher floor and drops it back one', (path) => {
    let s = newGame(5, path);
    for (let t = 0; t < 4 * 3600 && s.deaths === 0; t++) {
      const before = s;
      s = tick(s, 1);
      if (s.deaths > 0) {
        expect(before.floor).toBeGreaterThan(1);
        expect(s.floor).toBe(before.floor - 1);
        expect(s.highestFloor).toBe(before.floor);
        expect(s.cultivator.hp).toBeGreaterThan(0);
      }
    }
    expect(s.deaths).toBeGreaterThan(0);
  });

  it('never drops below floor 1', () => {
    let s = newGame(1, 'sword');
    for (const e of s.enemies) e.damage = 1e9;
    while (s.deaths === 0 && s.time < 120) s = tick(s, 1);
    expect(s.deaths).toBe(1);
    expect(s.floor).toBe(1);
  });

  it('starts each floor with full HP and a full enemy line-up', () => {
    let s = newGame(8, 'body');
    while (s.highestFloor < 3) s = tick(s, 1);
    expect(s.enemies[0]?.hp).toBe(s.enemies[0]?.maxHp);
  });
});

describe('mitigate', () => {
  it('passes damage through at 0 defence and halves it at 50', () => {
    expect(mitigate(10, 0)).toBe(10);
    expect(mitigate(10, 50)).toBe(5);
  });

  it('never deals less than 1', () => {
    expect(mitigate(1, 1e6)).toBe(1);
  });
});
