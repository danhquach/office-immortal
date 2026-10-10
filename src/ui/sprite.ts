// Sprite playback for the combat strip: which frame of a sheet shows when.
// Pure (no DOM), so it can be unit-tested; app.ts only puts the frame on the page.
//
// A sheet is 4 rows (idle, attack, hit, death) of up to 4 frames
// (tools/art/build.py). The sim decides every action; this only times them.

export type Action = 'idle' | 'attack' | 'hit' | 'death';

const ROW: Readonly<Record<Action, number>> = { idle: 0, attack: 1, hit: 2, death: 3 };
const FRAMES: Readonly<Record<Action, number>> = { idle: 4, attack: 4, hit: 2, death: 4 };
/** Milliseconds per frame. */
export const FRAME_MS: Readonly<Record<Action, number>> = {
  idle: 200,
  attack: 110,
  hit: 120,
  death: 200,
};
/** A death holds its last frame this long before it counts as done. Short: at
 * low floors the next kill often comes within a second. */
export const DEATH_HOLD_MS = 300;
/** Higher wins: a hit cuts an attack short, nothing cuts a death short. */
const PRIORITY: Readonly<Record<Action, number>> = { idle: 0, attack: 1, hit: 2, death: 3 };

export interface Playing {
  action: Action;
  /** When it started, in ms (performance.now()). */
  start: number;
}

/** How long an action plays before the sprite goes back to idle; idle never ends. */
export function duration(action: Action): number {
  if (action === 'idle') return Infinity;
  const ms = FRAMES[action] * FRAME_MS[action];
  return action === 'death' ? ms + DEATH_HOLD_MS : ms;
}

/**
 * What plays after `action` is asked for at `now`: it starts if it outranks
 * what is playing (or that has finished), otherwise the current one carries on.
 * An action of the same rank restarts, so back-to-back attacks each show.
 */
export function request(current: Playing, action: Action, now: number): Playing {
  const finished = now - current.start >= duration(current.action);
  if (finished || PRIORITY[action] >= PRIORITY[current.action]) return { action, start: now };
  return current;
}

/**
 * One frame tick of a sprite: the frame to show and what plays from now on. A
 * finished action goes back to idle; a `once` sprite (a corpse) is `gone` when
 * its action ends instead.
 */
export function advance(
  p: Playing,
  now: number,
  reduced: boolean,
  once = false,
): { playing: Playing; row: number; col: number; gone: boolean } {
  const frame = frameAt(p, now, reduced);
  if (!frame.done || once) return { playing: p, row: frame.row, col: frame.col, gone: frame.done };
  const idle: Playing = { action: 'idle', start: now };
  const next = frameAt(idle, now, reduced);
  return { playing: idle, row: next.row, col: next.col, gone: false };
}

/**
 * The frame to show at `now`: row and column in the sheet, and whether the
 * action is over. Reduced motion shows the first idle frame and nothing moves.
 */
export function frameAt(
  p: Playing,
  now: number,
  reduced: boolean,
): { row: number; col: number; done: boolean } {
  const t = Math.max(0, now - p.start);
  const done = t >= duration(p.action);
  if (reduced) return { row: ROW.idle, col: 0, done };
  const step = Math.floor(t / FRAME_MS[p.action]);
  const frames = FRAMES[p.action];
  const col = p.action === 'idle' ? step % frames : Math.min(step, frames - 1);
  return { row: ROW[p.action], col, done };
}
