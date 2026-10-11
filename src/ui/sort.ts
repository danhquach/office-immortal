// The inventory sort: how the bag grid orders its items. A display preference
// like the theme, kept in its own storage key, so Reset progress keeps it.
// Pure (storage is passed in), so it can be unit-tested; app.ts draws the grid.

import { GRADE_IDS, SLOT_IDS } from '../core/economy.ts';
import { type Item, quality } from '../core/loot.ts';
import type { MessageKey } from './i18n.ts';

export const BAG_SORT_KEY = 'office-immortal.bagSort';
export const BAG_REVERSE_KEY = 'office-immortal.bagSortReverse';
export const BAG_SORTS = ['grade', 'type', 'level', 'quality', 'newest'] as const;
export type BagSort = (typeof BAG_SORTS)[number];

/** The sort control's options (message keys), in menu order. */
export const BAG_SORT_NAMES: Readonly<Record<BagSort, MessageKey>> = {
  grade: 'sort.grade',
  type: 'sort.type',
  level: 'sort.level',
  quality: 'sort.quality',
  newest: 'sort.newest',
};

/** The direction button's text (message keys) for each sort: [normal, reversed]. */
export const BAG_SORT_DIRS: Readonly<Record<BagSort, readonly [MessageKey, MessageKey]>> = {
  grade: ['sort.highest', 'sort.lowest'],
  type: ['sort.headFirst', 'sort.charmFirst'],
  level: ['sort.highest', 'sort.lowest'],
  quality: ['sort.highest', 'sort.lowest'],
  newest: ['sort.oldest', 'sort.newestFirst'],
};

/** A sort from an untrusted value (storage, the select); anything else is Grade. */
export function pickBagSort(value: unknown): BagSort {
  return BAG_SORTS.find((s) => s === value) ?? 'grade';
}

/** Reversed only for the exact saved 'true'; anything else is the normal direction. */
export function pickBagReverse(value: unknown): boolean {
  return value === 'true';
}

/** The saved value under `key`, or null where storage is missing or throws. */
function read(storage: Pick<Storage, 'getItem'> | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Saves `value`; false where storage is blocked (it still applies this visit). */
function write(storage: Pick<Storage, 'setItem'> | null, key: string, value: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** The saved choice; anything else in storage, or no storage at all, is Grade. */
export function readBagSort(storage: Pick<Storage, 'getItem'> | null): BagSort {
  return pickBagSort(read(storage, BAG_SORT_KEY));
}

export function writeBagSort(storage: Pick<Storage, 'setItem'> | null, sort: BagSort): boolean {
  return write(storage, BAG_SORT_KEY, sort);
}

/** The saved direction; anything else in storage, or no storage at all, is normal. */
export function readBagReverse(storage: Pick<Storage, 'getItem'> | null): boolean {
  return pickBagReverse(read(storage, BAG_REVERSE_KEY));
}

export function writeBagReverse(
  storage: Pick<Storage, 'setItem'> | null,
  reverse: boolean,
): boolean {
  return write(storage, BAG_REVERSE_KEY, String(reverse));
}

type Key = (item: Item) => number;
/** Higher sorts first. */
const grade: Key = (i) => GRADE_IDS.indexOf(i.grade);
const level: Key = (i) => i.level;
// Character-panel order: Head first, so it gets the highest key.
const type: Key = (i) => -SLOT_IDS.indexOf(i.slot);

/** Each sort's keys, most significant first; ties fall back to grade, level, quality. */
const KEYS: Readonly<Record<Exclude<BagSort, 'newest'>, readonly Key[]>> = {
  grade: [grade, level, quality],
  type: [type, grade, level, quality],
  level: [level, grade, quality],
  quality: [quality, grade, level],
};

/**
 * The bag's display order: the inventory index shown in each cell, first cell
 * first. `reverse` flips the sort's direction; full ties keep drop order either
 * way, so the order never shuffles between draws.
 */
export function bagOrder(items: readonly Item[], sort: BagSort, reverse = false): number[] {
  const order = items.map((_, i) => i);
  if (sort === 'newest') return reverse ? order.reverse() : order;
  const sign = reverse ? -1 : 1;
  const keys = KEYS[sort];
  // Keys are worked out once per item, not once per comparison.
  const values = items.map((item) => keys.map((k) => k(item)));
  return order.sort((a, b) => {
    const va = values[a] as number[];
    const vb = values[b] as number[];
    for (let k = 0; k < va.length; k++) {
      const d = (vb[k] as number) - (va[k] as number);
      if (d !== 0) return sign * d;
    }
    return a - b;
  });
}
