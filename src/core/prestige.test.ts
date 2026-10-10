import { describe, expect, it } from 'vitest';
import { derive, PATHS, STARTING_PRIMARY_BONUS, BASE_STAT } from './cultivator.ts';
import { INVENTORY_SIZE, setFilter } from './economy.ts';
import { catchUp, MAX_OFFLINE_SECONDS } from './offline.ts';
import {
  buyPassive,
  canRetire,
  insightFor,
  noPassives,
  passiveCost,
  PASSIVE_IDS,
  PASSIVES,
  retirePreview,
  RETIRE_MIN_FLOOR,
} from './prestige.ts';
import { equip, newGame, retire, tick, type GameState } from './sim.ts';

/** A run some way up the tower, with gear, items and currencies to lose. */
function played(): GameState {
  let s = tick(newGame(11, 'sword'), 3 * 60 * 60);
  for (let i = 0; i < 2 && s.inventory.length > 0; i++) s = equip(s, 0);
  // Retiring pays on the highest floor reached; put it past the minimum.
  return { ...s, highestFloor: 25, stones: 1234, essence: 56, bagSize: INVENTORY_SIZE + 8 };
}

const PLAYED = played();

/** `s` with `n` Dao Insight to spend. */
function withInsight(s: GameState, n: number): GameState {
  return { ...s, insight: n };
}

describe('insightFor', () => {
  it('pays nothing below the minimum floor', () => {
    for (const floor of [1, 5, RETIRE_MIN_FLOOR - 1]) expect(insightFor(floor)).toBe(0);
  });

  it('is floor² / 50, rounded down, from the minimum floor', () => {
    expect(RETIRE_MIN_FLOOR).toBe(10);
    expect(insightFor(10)).toBe(2);
    expect(insightFor(15)).toBe(4);
    expect(insightFor(20)).toBe(8);
    expect(insightFor(50)).toBe(50);
    expect(insightFor(100)).toBe(200);
  });

  it('never falls as the floor rises', () => {
    for (let f = 1; f < 500; f++) expect(insightFor(f + 1)).toBeGreaterThanOrEqual(insightFor(f));
  });
});

describe('retire', () => {
  it('is refused, and not offered, with too little progress', () => {
    const early = { ...PLAYED, highestFloor: RETIRE_MIN_FLOOR - 1 };
    expect(canRetire(early)).toBe(false);
    expect(retirePreview(early).insight).toBe(0);
    expect(() => retire(early)).toThrow(RangeError);
    expect(canRetire(newGame(1, 'sword'))).toBe(false);
  });

  it('is offered from the minimum floor', () => {
    expect(canRetire({ ...PLAYED, highestFloor: RETIRE_MIN_FLOOR })).toBe(true);
  });

  it('restarts at floor 1, level 1 with nothing but insight, passives and the filter', () => {
    const before = setFilter(withInsight(PLAYED, 7), {
      minGrade: 'spirit',
      slots: ['weapon'],
      action: 'salvage',
    });
    const after = retire(before);
    const fresh = newGame(0, before.cultivator.path);
    expect(after).toMatchObject({
      floor: 1,
      highestFloor: 1,
      inventory: [],
      bagSize: INVENTORY_SIZE,
      stones: 0,
      essence: 0,
      kills: 0,
      deaths: 0,
      dropsSold: 0,
      dropsSalvaged: 0,
      insight: 7 + insightFor(25),
      retirements: 1,
      filter: before.filter,
    });
    expect(after.cultivator).toMatchObject({
      path: before.cultivator.path,
      level: 1,
      xp: 0,
      equipment: {},
      stats: fresh.cultivator.stats,
    });
    expect(after.enemies.length).toBeGreaterThan(0);
  });

  it('keeps the Path', () => {
    const talisman = { ...newGame(3, 'talisman'), highestFloor: 30 };
    expect(retire(talisman).cultivator.path).toBe('talisman');
  });

  it('leaves the input untouched and shares nothing with it', () => {
    const copy = structuredClone(PLAYED);
    const after = retire(PLAYED);
    expect(PLAYED).toEqual(copy);
    after.passives.xp = 9;
    after.filter.slots.pop();
    expect(PLAYED).toEqual(copy);
  });

  it('is reproducible: the next run is seeded from this one', () => {
    expect(retire(PLAYED)).toEqual(retire(PLAYED));
    expect(retire(PLAYED).rng).not.toEqual(newGame(11, 'sword').rng);
  });

  it('stops insight at the largest whole number a save can hold', () => {
    const rich = withInsight(PLAYED, Number.MAX_SAFE_INTEGER - 1);
    expect(retire(rich).insight).toBe(Number.MAX_SAFE_INTEGER);
    expect(retirePreview(rich).insightAfter).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('determinism with passives', () => {
  /** A run with every passive bought, so each one is in play. */
  function boosted(): GameState {
    let s = withInsight(newGame(13, 'talisman'), 1e9);
    for (const id of PASSIVE_IDS) for (let i = 0; i < 3; i++) s = buyPassive(s, id);
    return s;
  }

  it('plays the same events in one tick as in many small ones', () => {
    const s = boosted();
    let small = s;
    for (let i = 0; i < 600; i++) small = tick(small, 1);
    const big = tick(s, 600);
    expect(big.kills).toBeGreaterThan(0);
    expect(big).toEqual(small);
  });

  it('replays Overtime Cultivation exactly as the open tab would, under the raised cap', () => {
    const s = boosted();
    const away = MAX_OFFLINE_SECONDS + 2 * 3600;
    expect(catchUp(s, away).state).toEqual(tick(s, away));
  });
});

describe('retirePreview', () => {
  it('names what is kept and lost', () => {
    const p = retirePreview(withInsight(PLAYED, 3));
    expect(p).toEqual({
      insight: insightFor(25),
      insightAfter: 3 + insightFor(25),
      highestFloor: 25,
      level: PLAYED.cultivator.level,
      items: PLAYED.inventory.length + Object.keys(PLAYED.cultivator.equipment).length,
      stones: 1234,
      essence: 56,
      bagCells: 8,
    });
    expect(p.items).toBeGreaterThan(0);
  });
});

describe('passives', () => {
  it('cost twice the last rank, up to a max rank', () => {
    const p = noPassives();
    expect(passiveCost(p, 'xp')).toBe(2);
    p.xp = 3;
    expect(passiveCost(p, 'xp')).toBe(16);
    p.offline = PASSIVES.offline.maxRank;
    expect(passiveCost(p, 'offline')).toBeNull();
  });

  it('are bought with insight', () => {
    const s = buyPassive(withInsight(newGame(1, 'sword'), 5), 'treasure');
    expect(s.passives.treasure).toBe(1);
    expect(s.insight).toBe(3);
  });

  it('are refused without the insight, at the max rank, or for an unknown id', () => {
    const s = withInsight(newGame(1, 'sword'), 1);
    expect(() => buyPassive(s, 'xp')).toThrow(RangeError);
    const maxed = withInsight(newGame(1, 'sword'), 1e9);
    maxed.passives.offline = PASSIVES.offline.maxRank;
    expect(() => buyPassive(maxed, 'offline')).toThrow(RangeError);
    for (const id of ['godMode', '__proto__', 'toString']) {
      expect(() => buyPassive(maxed, id as 'xp')).toThrow(RangeError);
    }
  });

  it('leave the input untouched', () => {
    const s = withInsight(newGame(1, 'sword'), 50);
    const copy = structuredClone(s);
    buyPassive(s, 'points');
    expect(s).toEqual(copy);
  });

  it('persist across retirements', () => {
    let s = withInsight(PLAYED, 100);
    for (const id of PASSIVE_IDS) s = buyPassive(s, id);
    const ranks = { ...s.passives };
    s = retire(s);
    s = retire({ ...tick(s, 60), highestFloor: 12 });
    expect(s.passives).toEqual(ranks);
    expect(s.retirements).toBe(2);
  });

  it('XP: every kill pays more', () => {
    const base = newGame(5, 'body');
    let boosted = withInsight(base, 1e9);
    for (let i = 0; i < 5; i++) boosted = buyPassive(boosted, 'xp');
    // Up to the first kill: same events, only its XP differs (+50%, rounded).
    let a = base;
    while (a.kills === 0) a = tick(a, 0.5);
    const b = tick(boosted, a.time);
    expect(b.kills).toBe(1);
    expect(a.cultivator.xp).toBe(5);
    expect(b.cultivator.xp).toBe(Math.round(5 * 1.5));
  });

  it('treasure find: more drops over the same fights', () => {
    const base = newGame(9, 'sword');
    let boosted = withInsight(base, 1e9);
    for (let i = 0; i < 10; i++) boosted = buyPassive(boosted, 'treasure');
    const drops = (s: GameState) => s.inventory.length + s.dropsSold + s.dropsSalvaged;
    // The cultivator's combat is unchanged, so both runs fight the same enemies.
    expect(derive(boosted.cultivator)).toEqual(derive(base.cultivator));
    expect(drops(tick(boosted, 3600))).toBeGreaterThan(drops(tick(base, 3600)));
  });

  it('offline cap: an hour more of Overtime Cultivation per rank', () => {
    let s = withInsight(newGame(1, 'sword'), 1e9);
    for (let i = 0; i < 2; i++) s = buyPassive(s, 'offline');
    const { summary } = catchUp(s, 100 * 60 * 60);
    expect(summary).toMatchObject({ seconds: MAX_OFFLINE_SECONDS + 2 * 3600, capped: true });
    expect(catchUp(s, MAX_OFFLINE_SECONDS + 3600).summary.capped).toBe(false);
  });

  it('starting stat points: added to this run now, and to every run after', () => {
    const s0 = withInsight({ ...newGame(1, 'talisman'), highestFloor: 20 }, 100);
    const primary = PATHS.talisman.primary;
    const start = BASE_STAT + STARTING_PRIMARY_BONUS;
    expect(s0.cultivator.stats[primary]).toBe(start);
    const s1 = buyPassive(s0, 'points');
    expect(s1.cultivator.stats[primary]).toBe(start + 2);
    const s2 = retire(s1);
    expect(s2.cultivator.stats[primary]).toBe(start + 2);
    expect(s2.cultivator.hp).toBe(derive(s2.cultivator).maxHp);
  });

  it('starting stat points heal the max HP they add, as a level-up does', () => {
    const s = withInsight(newGame(1, 'body'), 100);
    const after = buyPassive(s, 'points');
    expect(derive(after.cultivator).maxHp).toBeGreaterThan(derive(s.cultivator).maxHp);
    expect(after.cultivator.hp).toBe(derive(after.cultivator).maxHp);
  });
});
