import { describe, expect, it } from 'vitest';
import css from '../page.css?raw';
import { defaultFolds, FOLD_KEY, FOLDS, pickFolds, readFolds, writeFolds } from './fold.ts';

function store(value: string | null): Pick<Storage, 'getItem'> {
  return { getItem: (k) => (k === FOLD_KEY ? value : null) };
}

describe('readFolds', () => {
  it('opens Offence and Defence and folds the rest with nothing saved or no storage', () => {
    const want = { Plan: false, Offence: true, Defence: true, Find: false, Boosts: false };
    expect(readFolds(store(null))).toEqual(want);
    expect(readFolds(null)).toEqual(want);
  });

  it('reads each saved group, keeping the default for one not named', () => {
    expect(readFolds(store('{"Find":"open","Offence":"closed","Plan":"open"}'))).toEqual({
      Plan: true,
      Offence: false,
      Defence: true,
      Find: true,
      Boosts: false,
    });
  });

  it('reads back what writeFolds saves', () => {
    const saved = new Map<string, string>();
    const folds = { Plan: true, Offence: false, Defence: false, Find: true, Boosts: true };
    writeFolds({ setItem: (k, v) => saved.set(k, v) }, folds);
    expect(readFolds(store(saved.get(FOLD_KEY) ?? null))).toEqual(folds);
  });

  it.each([
    ['empty', ''],
    ['not JSON', 'Find=open'],
    ['broken JSON', '{"Find":"open"'],
    ['a string', '"open"'],
    ['a number', '1'],
    ['null', 'null'],
    ['an array', '["Find","Boosts"]'],
    ['markup', '<img src=x onerror=alert(1)>'],
    ['oversized', `{"Find":"open","x":"${'a'.repeat(100_000)}"}`],
  ])('falls back to the defaults on a hostile value (%s)', (_, value) => {
    expect(readFolds(store(value))).toEqual(defaultFolds());
  });

  it.each([
    ['true instead of "open"', '{"Find":true,"Offence":false}'],
    ['a number', '{"Find":1}'],
    ['a nested object', '{"Find":{"open":true}}'],
    ['wrong case', '{"Find":"Open","Offence":"CLOSED"}'],
    ['padded', '{"Find":" open"}'],
    ['bidi override', '{"Find":"open\u202e"}'],
    ['zero-width', '{"Find":"op\u200ben"}'],
    ['look-alike', '{"Find":"\u043epen"}'],
  ])('ignores a group with a wrong value (%s)', (_, value) => {
    expect(readFolds(store(value))).toEqual(defaultFolds());
  });

  it.each([
    ['unknown name', '{"Gear":"open","find":"open"}'],
    ['__proto__', '{"__proto__":{"Find":"open"}}'],
    ['constructor', '{"constructor":{"prototype":{"Find":"open"}}}'],
    ['look-alike name', '{"F\u0456nd":"open"}'],
  ])('ignores names off the allow-list (%s)', (_, value) => {
    const folds = readFolds(store(value));
    expect(folds).toEqual(defaultFolds());
    expect(Object.keys(folds)).toEqual([...FOLDS]);
    expect(({} as Record<string, unknown>).Find).toBeUndefined();
  });

  it('falls back to the defaults when storage throws', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readFolds(blocked)).toEqual(defaultFolds());
  });

  it('only takes a string from storage', () => {
    expect(pickFolds({ Find: 'open' })).toEqual(defaultFolds());
    expect(pickFolds(undefined)).toEqual(defaultFolds());
  });

  it('hands out a fresh object each time', () => {
    const a = readFolds(null);
    a.Find = true;
    expect(readFolds(null).Find).toBe(false);
  });
});

describe('writeFolds', () => {
  it('saves every group, open or closed, under the folds key', () => {
    const saved = new Map<string, string>();
    expect(writeFolds({ setItem: (k, v) => saved.set(k, v) }, defaultFolds())).toBe(true);
    expect(JSON.parse(saved.get(FOLD_KEY) ?? '')).toEqual({
      Plan: 'closed',
      Offence: 'open',
      Defence: 'open',
      Find: 'closed',
      Boosts: 'closed',
    });
  });

  it('reports blocked or missing storage', () => {
    const full = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(writeFolds(full, defaultFolds())).toBe(false);
    expect(writeFolds(null, defaultFolds())).toBe(false);
  });
});

describe('page.css', () => {
  it('hides a folded body over its own display rule (the grid lists)', () => {
    expect(css).toMatch(/\.fold > \[hidden\] \{\s*display: none;\s*\}/);
  });
});
