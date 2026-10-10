// Overtime Cultivation: the time away is replayed through the same tick() the
// page uses, so offline progress is what an open tab would have made, except
// that items drop less often (docs/design.md §10). Pure: the caller passes in
// the clock.

import { OFFLINE_SECONDS_PER_RANK, type Passives } from './prestige.ts';
import { tick, type GameState } from './sim.ts';

/** The most time away that is replayed before passives: 8 hours, in seconds. */
export const MAX_OFFLINE_SECONDS = 8 * 60 * 60;

/** The most time away that is replayed, with the Flexible Hours passive. */
export function offlineCap(p: Passives): number {
  return MAX_OFFLINE_SECONDS + OFFLINE_SECONDS_PER_RANK * p.offline;
}

/** What happened while away, for the summary shown on return. */
export interface OvertimeSummary {
  /** Seconds replayed, after the cap. */
  seconds: number;
  /** True when the time away was longer than the cap. */
  capped: boolean;
  floorsClimbed: number;
  levels: number;
  kills: number;
  dropsKept: number;
  /** Drops sold or salvaged on pickup, by the filter or a full bag. */
  dropsSold: number;
  dropsSalvaged: number;
  stones: number;
  essence: number;
}

/**
 * Seconds between a save stamp and now (both in ms since the epoch). Not
 * capped here: catchUp() caps it and tells the summary it did. A clock that
 * went backwards, or a stamp that isn't a number, gives 0.
 */
export function offlineSeconds(savedAtMs: number, nowMs: number): number {
  const seconds = (nowMs - savedAtMs) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

/** Replays `awaySeconds` (capped) and returns the new state with its summary. */
export function catchUp(
  state: GameState,
  awaySeconds: number,
): { state: GameState; summary: OvertimeSummary } {
  const cap = offlineCap(state.passives);
  const capped = awaySeconds > cap;
  const seconds = Number.isNaN(awaySeconds) ? 0 : Math.min(cap, Math.max(0, awaySeconds));
  const after = tick(state, seconds, { offline: true });
  return {
    state: after,
    summary: {
      seconds,
      capped,
      floorsClimbed: after.highestFloor - state.highestFloor,
      levels: after.cultivator.level - state.cultivator.level,
      kills: after.kills - state.kills,
      // tick() only ever adds to the bag (equipping is the player's move).
      dropsKept: after.inventory.length - state.inventory.length,
      dropsSold: after.dropsSold - state.dropsSold,
      dropsSalvaged: after.dropsSalvaged - state.dropsSalvaged,
      stones: after.stones - state.stones,
      essence: after.essence - state.essence,
    },
  };
}
