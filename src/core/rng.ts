/** A seeded random source returning floats in [0, 1). */
export type Rng = () => number;

/**
 * Mulberry32: small, fast and good enough for game rolls. The only randomness
 * source in the game, so a run (and its offline catch-up) replays from a seed.
 */
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole number in [min, max], both ends inclusive. */
export function int(rng: Rng, min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
    throw new RangeError(`int: bad range [${min}, ${max}]`);
  }
  return min + Math.floor(rng() * (max - min + 1));
}

/** One item of a non-empty list, each equally likely. */
export function pick<T>(rng: Rng, list: readonly T[]): T {
  if (list.length === 0) throw new RangeError('pick: empty list');
  // In range: the list is non-empty and int() stays within its indices.
  return list[int(rng, 0, list.length - 1)] as T;
}

/** True with probability p: 0 never, 1 always. */
export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}
