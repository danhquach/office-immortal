import { describe, expect, it } from 'vitest';
import { catchUp, MAX_OFFLINE_SECONDS, offlineSeconds } from './offline.ts';
import {
  faceTribulation,
  newGame,
  setAutoTribulation,
  tick,
  TRIAL_LOSS_LIMIT,
  TRIAL_RETRY_SECONDS,
  trialSetAside,
  type GameState,
} from './sim.ts';
import { skipToTribulation } from '../dev/scenarios.ts';

const HOUR_MS = 60 * 60 * 1000;

describe('offlineSeconds', () => {
  it('is the time since the stamp, in seconds', () => {
    expect(offlineSeconds(1_000, 91_000)).toBe(90);
  });

  it('is left uncapped, for catchUp to cap and report', () => {
    expect(offlineSeconds(0, 30 * HOUR_MS)).toBe(30 * 60 * 60);
  });

  it('gives 0 when the clock went backwards', () => {
    expect(offlineSeconds(5 * HOUR_MS, 2 * HOUR_MS)).toBe(0);
  });

  it.each([NaN, Infinity, -Infinity])('gives 0 for a stamp of %s', (stamp) => {
    expect(offlineSeconds(stamp, Date.now())).toBe(0);
  });
});

describe('catchUp', () => {
  it('replays the time away through the sim, at the offline drop rate', () => {
    const start = newGame(9, 'sword');
    const { state } = catchUp(start, 600);
    expect(state).toEqual(tick(start, 600, { offline: true }));
  });

  // Every drop, kept, sold or salvaged on pickup.
  const drops = (s: GameState): number => s.inventory.length + s.dropsSold + s.dropsSalvaged;

  it('drops about half as often as an open tab, background or not, for the same kills', () => {
    let online = 0;
    let offline = 0;
    let onlineKills = 0;
    let offlineKills = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const start = newGame(seed, 'sword');
      // An open tab, foreground or background, plays tick() with no options.
      const open = tick(start, MAX_OFFLINE_SECONDS);
      const away = catchUp(start, MAX_OFFLINE_SECONDS).state;
      online += drops(open);
      offline += drops(away);
      onlineKills += open.kills;
      offlineKills += away.kills;
    }
    const ratio = offline / offlineKills / (online / onlineKills);
    // Tribulations always drop, online and offline, so the ratio sits a little above 0.5.
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.65);
  });

  it('caps time away measured from a save stamp, as the page does', () => {
    expect(MAX_OFFLINE_SECONDS).toBe(8 * 60 * 60);
    const start = newGame(9, 'sword');
    const { state, summary } = catchUp(start, offlineSeconds(0, 3 * 24 * HOUR_MS));
    expect(summary).toMatchObject({ seconds: MAX_OFFLINE_SECONDS, capped: true });
    expect(state.time).toBe(MAX_OFFLINE_SECONDS);
  });

  it('never replays past the cap', () => {
    const start = newGame(9, 'body');
    const { state, summary } = catchUp(start, 3 * MAX_OFFLINE_SECONDS);
    expect(summary).toMatchObject({ seconds: MAX_OFFLINE_SECONDS, capped: true });
    expect(state.time).toBe(MAX_OFFLINE_SECONDS);
  });

  it.each([0, -50, NaN])('replays nothing for %s seconds', (away) => {
    const start = newGame(9, 'talisman');
    const { state, summary } = catchUp(start, away);
    expect(state).toEqual(start);
    expect(summary).toEqual({
      seconds: 0,
      capped: false,
      floorsClimbed: 0,
      levels: 0,
      kills: 0,
      dropsKept: 0,
      dropsSold: 0,
      dropsSalvaged: 0,
      stones: 0,
      essence: 0,
      boostsEnded: [],
    });
  });

  it('sums up what happened', () => {
    const start = newGame(9, 'sword');
    const { state, summary } = catchUp(start, 2 * 60 * 60);
    expect(summary.capped).toBe(false);
    expect(summary.floorsClimbed).toBe(state.highestFloor - 1);
    expect(summary.levels).toBe(state.cultivator.level - 1);
    expect(summary.kills).toBe(state.kills);
    expect(summary.dropsKept).toBe(state.inventory.length);
    expect(summary.dropsSold).toBe(state.dropsSold);
    expect(summary.stones).toBe(state.stones);
    // Two hours is enough to see progress on every count that the summary shows.
    expect(summary.kills).toBeGreaterThan(0);
    expect(summary.levels).toBeGreaterThan(0);
  });

  it('leaves the input state untouched', () => {
    const start = newGame(9, 'body');
    const copy = structuredClone(start);
    catchUp(start, 600);
    expect(start).toEqual(copy);
  });
});

describe('catchUp and the Tribulation retry limit', () => {
  /** Held at level 10 and set aside after TRIAL_LOSS_LIMIT losses. */
  function setAside(): GameState {
    // Straight to the level 10 cap with its Tribulation queued (the dev scenario).
    let s = skipToTribulation(newGame(7, 'sword'));
    while (s.trial.losses < TRIAL_LOSS_LIMIT) {
      const losses = s.trial.losses;
      s = s.enemies[0]?.kind === 'tribulation' ? structuredClone(s) : faceTribulation(s);
      s.enemies[0]!.damage = 1e9;
      s.enemies[0]!.hp = s.enemies[0]!.maxHp = 1e12;
      while (s.trial.losses === losses) s = tick(s, 1);
    }
    return s;
  }

  it('plays the limit and a time retry that lands while away as an open tab would', () => {
    const s = setAside();
    expect(trialSetAside(s)).toBe(true);
    const away = TRIAL_RETRY_SECONDS + 600;
    const { state } = catchUp(s, away);
    const live = tick(s, away);
    // The retry was fought while away: lost again (and the timer restarted) or won.
    expect(state.trial.losses > TRIAL_LOSS_LIMIT || state.cultivator.level > 10).toBe(true);
    // The same retry, at the same time, with the same outcome as an open tab. (Later
    // fights may part ways: offline drop rolls draw other numbers from the RNG.)
    expect(state.trial).toEqual(live.trial);
    expect(state.cultivator.level).toBe(live.cultivator.level);
    // And the same as many small offline steps.
    let steps = s;
    for (let i = 0; i < away; i++) steps = tick(steps, 1, { offline: true });
    expect(state).toEqual(steps);
  });

  it('never retries while away with Auto-Tribulation off', () => {
    const s = setAutoTribulation(setAside(), false);
    const { state } = catchUp(s, 3 * TRIAL_RETRY_SECONDS);
    expect(state.trial).toEqual(s.trial);
    expect(state.floor).toBe(s.floor);
    expect(state.cultivator.level).toBe(10);
  });
});
