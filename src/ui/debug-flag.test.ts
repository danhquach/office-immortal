import { describe, expect, it } from 'vitest';
import type { SaveStorage } from '../storage/save.ts';
import { clearDebugged, DEBUG_KEY, debugged, markDebugged } from './debug-flag.ts';

function memory(): SaveStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const blocked: SaveStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('the Debug panel mark (cloud save off)', () => {
  it('is off until marked, on once marked, off again after a fresh run', () => {
    const s = memory();
    expect(debugged(s)).toBe(false);
    expect(markDebugged(s, 123)).toBe(true);
    expect(s.data.get(DEBUG_KEY)).toBe('123');
    expect(debugged(s)).toBe(true);
    clearDebugged(s);
    expect(debugged(s)).toBe(false);
  });

  it('counts any stored value as marked, so the cloud stays off when unsure', () => {
    const s = memory();
    s.data.set(DEBUG_KEY, '');
    expect(debugged(s)).toBe(true);
  });

  it('is off with no storage or blocked storage, and never throws', () => {
    expect(debugged(null)).toBe(false);
    expect(debugged(blocked)).toBe(false);
    expect(markDebugged(blocked, 1)).toBe(false);
    expect(() => clearDebugged(blocked)).not.toThrow();
  });
});
