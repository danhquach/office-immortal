// The Spirit Stone store (docs/design.md §8): a rotating stock of gear chests
// and timed boosts. Every number here is a starting point for balancing.
//
// The stock is rolled from the game's seeded stream, state.rng, but never
// inside tick(): it rotates by the sim clock, and syncStore() rolls a new one
// the first time it is asked after a rotation is due. So tick() draws the same
// numbers as before, and the store stays one roll per rotation however the
// time passed (an open tab or Overtime Cultivation).
//
// Boosts are sim-time expiries; the sim reads them at each kill, so a boost
// that runs out mid-tick stops at the exact kill it should.

import { pay, SELL_VALUE } from './economy.ts';
import { rollItem, type GradeId } from './loot.ts';
import { int, rngFrom } from './rng.ts';
import type { GameState } from './sim.ts';

/** Sim seconds between rotations of the stock. */
export const ROTATION_SECONDS = 30 * 60;
/** Offers on show at once. */
export const STOCK_SIZE = 4;
/** Sim seconds one boost purchase adds. */
export const BOOST_SECONDS = 10 * 60;
/** The most time a boost can have left. */
export const BOOST_CAP_SECONDS = 60 * 60;
/** What an active boost adds: +50% XP, treasure find or spirit stone find. */
export const BOOST_BONUS = 0.5;
/** A chest costs this many times what selling one item of its grade at the current floor pays. */
export const CHEST_PRICE_MULT = 3;
/** Refresh now, in Spirit Stones per cultivator level. */
export const REFRESH_COST = 50;

export type BoostId = 'xp' | 'treasure' | 'stones';
export const BOOST_IDS: readonly BoostId[] = ['xp', 'treasure', 'stones'];

/** Boost prices, in Spirit Stones per cultivator level. */
export const BOOST_PRICE: Readonly<Record<BoostId, number>> = { xp: 20, treasure: 30, stones: 20 };

export type ChestGrade = Extract<GradeId, 'spirit' | 'earth' | 'heaven'>;
export const CHEST_GRADES: readonly ChestGrade[] = ['spirit', 'earth', 'heaven'];

export type OfferId = `chest-${ChestGrade}` | `boost-${BoostId}`;
/** The catalog, in the order the store's icon atlas holds it. */
export const OFFER_IDS: readonly OfferId[] = [
  ...CHEST_GRADES.map((g) => `chest-${g}` as const),
  ...BOOST_IDS.map((b) => `boost-${b}` as const),
];

export interface StoreState {
  /** The rotation the stock was rolled for (rotationAt); -1 before the first roll. */
  rotation: number;
  /** The offers on show, STOCK_SIZE of them once rolled, no repeats. */
  offers: OfferId[];
  /** Whether each offer has been bought this rotation, by position. */
  sold: boolean[];
}

/** Each boost's expiry in sim seconds; a time at or before now means it is off. */
export type Boosts = Record<BoostId, number>;

export function emptyStore(): StoreState {
  return { rotation: -1, offers: [], sold: [] };
}

export function noBoosts(): Boosts {
  return { xp: 0, treasure: 0, stones: 0 };
}

/** Which rotation the sim clock is in. */
export function rotationAt(time: number): number {
  return Math.floor(time / ROTATION_SECONDS);
}

/** Sim seconds until the stock next rotates. */
export function nextRotationIn(state: GameState): number {
  return (rotationAt(state.time) + 1) * ROTATION_SECONDS - state.time;
}

/** What boost `id` adds right now: BOOST_BONUS while active, else 0. */
export function boostBonus(state: GameState, id: BoostId): number {
  return state.boosts[id] > state.time ? BOOST_BONUS : 0;
}

/** Sim seconds boost `id` has left; 0 when off. */
export function boostLeft(state: GameState, id: BoostId): number {
  return Math.max(0, state.boosts[id] - state.time);
}

/** True when the stock on show is not the current rotation's, so syncStore() would roll. */
export function storeStale(state: GameState): boolean {
  return state.store.rotation !== rotationAt(state.time);
}

/** Rolls a fresh stock into `s` (a clone), STOCK_SIZE offers from the catalog without repeats. */
function restock(s: GameState): void {
  const rng = rngFrom(s.rng);
  const pool = [...OFFER_IDS];
  const offers: OfferId[] = [];
  for (let n = 0; n < STOCK_SIZE; n++)
    offers.push(pool.splice(int(rng, 0, pool.length - 1), 1)[0] as OfferId);
  s.store = { rotation: rotationAt(s.time), offers, sold: offers.map(() => false) };
}

/** The state with the current rotation's stock: `state` itself when already current. */
export function syncStore(state: GameState): GameState {
  if (!storeStale(state)) return state;
  const s = structuredClone(state);
  restock(s);
  return s;
}

/** The grade of chest offer `id`; null for a boost. */
export function chestGrade(id: OfferId): ChestGrade | null {
  const g = id.startsWith('chest-') ? id.slice('chest-'.length) : null;
  return CHEST_GRADES.includes(g as ChestGrade) ? (g as ChestGrade) : null;
}

/** The boost offer `id` sells; null for a chest. */
export function boostOf(id: OfferId): BoostId | null {
  const b = id.startsWith('boost-') ? id.slice('boost-'.length) : null;
  return BOOST_IDS.includes(b as BoostId) ? (b as BoostId) : null;
}

/** What offer `id` costs now, in Spirit Stones. */
export function offerPrice(state: GameState, id: OfferId): number {
  const grade = chestGrade(id);
  if (grade) return CHEST_PRICE_MULT * SELL_VALUE[grade] * state.floor;
  const boost = boostOf(id);
  if (boost) return BOOST_PRICE[boost] * state.cultivator.level;
  throw new RangeError('offerPrice: unknown offer');
}

export function refreshCost(state: GameState): number {
  return REFRESH_COST * state.cultivator.level;
}

/** Why offer `at` can't be bought now, or null when it can. Price is checked last. */
export type OfferBlock = 'sold' | 'bagFull' | 'boostCap' | 'stones';

export function offerBlock(state: GameState, at: number): OfferBlock | null {
  // Checked first: a position outside the current stock throws rather than reads as sold.
  const id = offerAt(state, at);
  if (state.store.sold[at]) return 'sold';
  if (chestGrade(id) && state.inventory.length >= state.bagSize) return 'bagFull';
  const boost = boostOf(id);
  // Expiries compared as stored: on a fractional clock, expiry - time can miss the cap by a rounding step.
  if (boost && state.boosts[boost] >= state.time + BOOST_CAP_SECONDS) return 'boostCap';
  if (state.stones < offerPrice(state, id)) return 'stones';
  return null;
}

function offerAt(state: GameState, at: number): OfferId {
  if (storeStale(state)) throw new RangeError('store: the stock is out of date');
  const id = Number.isInteger(at) ? state.store.offers[at] : undefined;
  if (id === undefined) throw new RangeError('store: no offer there');
  return id;
}

/**
 * Buys offer `at` of the current stock, returning the new state; `state` is
 * left untouched. A chest puts one item of the current floor's level, of its
 * grade or better, straight into the bag (the auto filter never sees it: the
 * player paid for it). A boost adds BOOST_SECONDS, up to BOOST_CAP_SECONDS
 * left. Throws when offerBlock() says no, or the stock is out of date.
 */
export function buyOffer(state: GameState, at: number): GameState {
  const id = offerAt(state, at);
  const block = offerBlock(state, at);
  if (block) throw new RangeError(`buyOffer: ${block}`);
  const s = pay(state, 'stones', offerPrice(state, id), 'buyOffer');
  s.store.sold[at] = true;
  const grade = chestGrade(id);
  if (grade) s.inventory.push(rollItem(rngFrom(s.rng), s.floor, grade));
  const boost = boostOf(id);
  if (boost) {
    const from = Math.max(s.boosts[boost], s.time);
    s.boosts[boost] = Math.min(s.time + BOOST_CAP_SECONDS, from + BOOST_SECONDS);
  }
  return s;
}

/** Rolls a new stock now, for refreshCost(); the rotation clock is unchanged. Throws on a stale stock, as buyOffer does. */
export function refreshStore(state: GameState): GameState {
  if (storeStale(state)) throw new RangeError('store: the stock is out of date');
  const s = pay(state, 'stones', refreshCost(state), 'refreshStore');
  restock(s);
  return s;
}
