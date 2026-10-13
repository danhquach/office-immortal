import { describe, expect, it } from 'vitest';
import { pickPopStyle, POP_STYLE_KEY, readPopStyle, writePopStyle } from './pop-style.ts';

function store(value: string | null): Pick<Storage, 'getItem'> {
  return { getItem: (k) => (k === POP_STYLE_KEY ? value : null) };
}

describe('readPopStyle', () => {
  it('is Mini with nothing saved or no storage', () => {
    expect(readPopStyle(store(null))).toBe('mini');
    expect(readPopStyle(null)).toBe('mini');
  });

  it('reads each saved choice', () => {
    expect(readPopStyle(store('mini'))).toBe('mini');
    expect(readPopStyle(store('discreet'))).toBe('discreet');
  });

  it.each([
    ['empty', ''],
    ['wrong case', 'Discreet'],
    ['padded', ' discreet'],
    ['prototype key', '__proto__'],
    ['constructor', 'constructor'],
    ['markup', '<img src=x onerror=alert(1)>'],
    ['bidi override', 'discreet‮'],
    ['zero-width', 'disc​reet'],
    ['look-alike', 'dіscreet'],
    ['JSON', '{"popStyle":"discreet"}'],
    ['oversized', 'discreet'.repeat(100_000)],
  ])('falls back to Mini on a hostile value (%s)', (_, value) => {
    expect(readPopStyle(store(value))).toBe('mini');
  });

  it('falls back to Mini when storage throws', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readPopStyle(blocked)).toBe('mini');
  });
});

describe('writePopStyle', () => {
  it('saves under its own key', () => {
    const saved = new Map<string, string>();
    expect(writePopStyle({ setItem: (k, v) => saved.set(k, v) }, 'discreet')).toBe(true);
    expect(saved.get(POP_STYLE_KEY)).toBe('discreet');
  });

  it('reports blocked or missing storage', () => {
    const full = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(writePopStyle(full, 'discreet')).toBe(false);
    expect(writePopStyle(null, 'discreet')).toBe(false);
  });
});

describe('pickPopStyle', () => {
  it('passes only the known styles', () => {
    expect(pickPopStyle('discreet')).toBe('discreet');
    expect(pickPopStyle(1)).toBe('mini');
    expect(pickPopStyle(undefined)).toBe('mini');
  });
});
