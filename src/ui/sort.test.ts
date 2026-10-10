import { describe, expect, it } from 'vitest';
import type { Item } from '../core/loot.ts';
import { clearSave, SAVE_KEY } from '../storage/save.ts';
import {
  BAG_REVERSE_KEY,
  BAG_SORT_DIRS,
  BAG_SORT_KEY,
  BAG_SORT_NAMES,
  BAG_SORTS,
  bagOrder,
  pickBagReverse,
  pickBagSort,
  readBagReverse,
  readBagSort,
  writeBagReverse,
  writeBagSort,
} from './sort.ts';

/** An item with no affixes, so its quality is the base roll as a percent. */
const item = (slot: Item['slot'], grade: Item['grade'], level: number, baseRoll: number): Item => ({
  slot,
  name: `${grade} ${slot}`,
  level,
  grade,
  baseRoll,
  affixes: [],
});

const bag: Item[] = [
  item('charm', 'mortal', 5, 0.9), // 0
  item('weapon', 'heaven', 3, 0.2), // 1
  item('head', 'spirit', 9, 0.5), // 2
  item('weapon', 'immortal', 1, 0.1), // 3
  item('head', 'spirit', 9, 0.7), // 4
  item('boots', 'heaven', 3, 0.6), // 5
];

describe('bagOrder', () => {
  it('sorts by grade, Immortal first, then level and quality', () => {
    expect(bagOrder(bag, 'grade')).toEqual([3, 5, 1, 4, 2, 0]);
  });

  it('groups by item type in character-panel order', () => {
    expect(bagOrder(bag, 'type')).toEqual([4, 2, 5, 3, 1, 0]);
  });

  it('sorts by item level, highest first, then grade and quality', () => {
    expect(bagOrder(bag, 'level')).toEqual([4, 2, 0, 5, 1, 3]);
  });

  it('sorts by quality, highest first', () => {
    expect(bagOrder(bag, 'quality')).toEqual([0, 4, 5, 2, 1, 3]);
  });

  it('keeps drop order for Drop order', () => {
    expect(bagOrder(bag, 'newest')).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('keeps drop order between full ties, so the order is stable', () => {
    const twins = [item('head', 'earth', 4, 0.5), item('head', 'earth', 4, 0.5)];
    for (const sort of BAG_SORTS) expect(bagOrder(twins, sort)).toEqual([0, 1]);
  });

  it('reverses each sort', () => {
    expect(bagOrder(bag, 'grade', true)).toEqual([0, 2, 4, 1, 5, 3]);
    expect(bagOrder(bag, 'type', true)).toEqual([0, 1, 3, 5, 2, 4]);
    expect(bagOrder(bag, 'level', true)).toEqual([3, 1, 5, 0, 2, 4]);
    expect(bagOrder(bag, 'quality', true)).toEqual([3, 1, 2, 5, 4, 0]);
    expect(bagOrder(bag, 'newest', true)).toEqual([5, 4, 3, 2, 1, 0]);
  });

  it('keeps drop order between full ties when reversed too', () => {
    const twins = [item('head', 'earth', 4, 0.5), item('head', 'earth', 4, 0.5)];
    for (const sort of BAG_SORTS.filter((s) => s !== 'newest')) {
      expect(bagOrder(twins, sort, true)).toEqual([0, 1]);
    }
  });

  it('names both directions of every sort', () => {
    expect(BAG_SORT_DIRS.newest).toEqual(['Oldest first', 'Newest first']);
    for (const sort of BAG_SORTS) expect(BAG_SORT_DIRS[sort]).toHaveLength(2);
  });

  it('puts a new drop in its sorted place, not at the end', () => {
    const more = [...bag, item('chest', 'immortal', 9, 1)];
    expect(bagOrder(more, 'grade')[0]).toBe(6);
  });

  it('shows the next sorted item in a sold item’s cell', () => {
    // Selling inventory[5] (cell 1 by grade): the shift leaves cell 1 to the next Heaven item.
    const order = bagOrder(bag, 'grade');
    const at = order.indexOf(5);
    const next = bag.filter((_, i) => i !== 5);
    const now = bagOrder(next, 'grade')[at] as number;
    expect(next[now]).toBe(bag[order[at + 1] as number]);
  });

  it('lists every index once and leaves the bag untouched', () => {
    const copy = structuredClone(bag);
    for (const sort of BAG_SORTS) {
      expect([...bagOrder(bag, sort)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    }
    expect(bag).toEqual(copy);
    expect(bagOrder([], 'grade')).toEqual([]);
  });

  it('names every sort', () => {
    expect(BAG_SORTS.map((s) => BAG_SORT_NAMES[s])).toEqual([
      'Grade',
      'Item type',
      'Item level',
      'Quality %',
      'Drop order',
    ]);
  });
});

function store(value: string | null): Pick<Storage, 'getItem'> {
  return { getItem: (k) => (k === BAG_SORT_KEY ? value : null) };
}

describe('readBagSort', () => {
  it('is Grade with nothing saved or no storage', () => {
    expect(readBagSort(store(null))).toBe('grade');
    expect(readBagSort(null)).toBe('grade');
  });

  it('reads each saved choice', () => {
    for (const sort of BAG_SORTS) expect(readBagSort(store(sort))).toBe(sort);
  });

  it.each([
    ['empty', ''],
    ['wrong case', 'Level'],
    ['padded', ' level'],
    ['prototype key', '__proto__'],
    ['constructor', 'constructor'],
    ['toString', 'toString'],
    ['markup', '<img src=x onerror=alert(1)>'],
    ['bidi override', 'level‮'],
    ['zero-width', 'lev​el'],
    ['look-alike', 'lеvel'],
    ['JSON', '{"sort":"level"}'],
    ['oversized', 'level'.repeat(100_000)],
  ])('falls back to Grade on a hostile value (%s)', (_, value) => {
    expect(readBagSort(store(value))).toBe('grade');
  });

  it('falls back to Grade when storage throws', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readBagSort(blocked)).toBe('grade');
  });

  it('picks Grade for a non-string value', () => {
    expect(pickBagSort(undefined)).toBe('grade');
    expect(pickBagSort(3)).toBe('grade');
    expect(pickBagSort(['level'])).toBe('grade');
  });
});

describe('writeBagSort', () => {
  it('saves under the sort key', () => {
    const saved = new Map<string, string>();
    expect(writeBagSort({ setItem: (k, v) => saved.set(k, v) }, 'quality')).toBe(true);
    expect(saved.get(BAG_SORT_KEY)).toBe('quality');
  });

  it('reports blocked or missing storage', () => {
    const full = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(writeBagSort(full, 'level')).toBe(false);
    expect(writeBagSort(null, 'level')).toBe(false);
  });

  it('survives Reset progress, which only deletes the save', () => {
    const data = new Map<string, string>([
      [SAVE_KEY, '{}'],
      [BAG_SORT_KEY, 'type'],
    ]);
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
    expect(clearSave(storage)).toBe(true);
    expect(readBagSort(storage)).toBe('type');
  });
});

describe('the sort direction', () => {
  const at = (value: string | null): Pick<Storage, 'getItem'> => ({
    getItem: (k) => (k === BAG_REVERSE_KEY ? value : null),
  });

  it('is normal with nothing saved, no storage or storage that throws', () => {
    expect(readBagReverse(at(null))).toBe(false);
    expect(readBagReverse(null)).toBe(false);
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readBagReverse(blocked)).toBe(false);
  });

  it('saves and reads back both directions', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    expect(writeBagReverse(storage, true)).toBe(true);
    expect(readBagReverse(storage)).toBe(true);
    expect(writeBagReverse(storage, false)).toBe(true);
    expect(readBagReverse(storage)).toBe(false);
    expect(writeBagReverse(null, true)).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['wrong case', 'True'],
    ['padded', ' true'],
    ['number', '1'],
    ['prototype key', '__proto__'],
    ['markup', '<img src=x onerror=alert(1)>'],
    ['bidi override', 'true\u202e'],
    ['zero-width', 'tr\u200bue'],
    ['look-alike', 'tru\u0435'],
    ['JSON', '{"reverse":true}'],
    ['oversized', 'true'.repeat(100_000)],
  ])('is normal on a hostile value (%s)', (_, value) => {
    expect(readBagReverse(at(value))).toBe(false);
  });

  it('is reversed only for the string true', () => {
    expect(pickBagReverse('true')).toBe(true);
    expect(pickBagReverse(true)).toBe(false);
    expect(pickBagReverse(undefined)).toBe(false);
  });

  it('survives Reset progress', () => {
    const data = new Map<string, string>([
      [SAVE_KEY, '{}'],
      [BAG_REVERSE_KEY, 'true'],
    ]);
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
    expect(clearSave(storage)).toBe(true);
    expect(readBagReverse(storage)).toBe(true);
  });
});
