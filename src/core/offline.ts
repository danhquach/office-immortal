// Overtime Cultivation: the time away is replayed through the same tick() the
// page uses, so offline progress is exactly what an open tab would have made
// (docs/design.md §10). Pure: the caller passes in the clock.

import { tick, type GameState } from './sim.ts';

/** The most time away that is replayed: 8 hours, in seconds. */
export const MAX_OFFLINE_SECONDS = 8 * 60 * 60;

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
  dropsLost: number;
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
  const capped = awaySeconds > MAX_OFFLINE_SECONDS;
  const seconds = Number.isNaN(awaySeconds)
    ? 0
    : Math.min(MAX_OFFLINE_SECONDS, Math.max(0, awaySeconds));
  const after = tick(state, seconds);
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
      dropsLost: after.dropsLost - state.dropsLost,
    },
  };
}
