import { describe, expect, it } from 'vitest';
import { bumpProblems, tagProblems } from '../tools/version-checks.mjs';

describe('bumpProblems', () => {
  const bump = (base: string, head: string, locks = [head, head]): string[] =>
    bumpProblems({ base, head, locks });

  it('lets a higher version through', () => {
    expect(bump('0.6.1', '0.6.2')).toEqual([]);
    expect(bump('0.6.9', '0.7.0')).toEqual([]);
    expect(bump('0.9.9', '1.0.0')).toEqual([]);
    expect(bump('0.6.9', '0.6.10')).toEqual([]);
  });

  it('refuses the same or a lower version', () => {
    expect(bump('0.6.2', '0.6.2')).toHaveLength(1);
    expect(bump('0.7.0', '0.6.9')).toHaveLength(1);
    expect(bump('1.0.0', '0.9.9')).toHaveLength(1);
    // Compared as numbers, not text.
    expect(bump('0.6.10', '0.6.9')).toHaveLength(1);
  });

  it('refuses a version that is not x.y.z', () => {
    expect(bump('0.6.1', '0.6.2-beta')).toHaveLength(1);
    expect(bump('0.6.1', 'v0.6.2')).toHaveLength(1);
    expect(bump('0.6.1', '00.6.2')).toHaveLength(1);
  });

  it('refuses a lockfile that names another version', () => {
    expect(bump('0.6.1', '0.6.2', ['0.6.1', '0.6.2'])).toHaveLength(1);
    expect(bump('0.6.1', '0.6.2', ['0.6.2', '0.6.1'])).toHaveLength(1);
    expect(bump('0.6.1', '0.6.2', ['0.6.2', undefined as unknown as string])).toHaveLength(1);
  });
});

describe('tagProblems', () => {
  it('wants the tag to name the version it ships', () => {
    expect(tagProblems({ tag: 'v0.6.2', version: '0.6.2' })).toEqual([]);
    expect(tagProblems({ tag: 'v0.7.0', version: '0.6.2' })).toHaveLength(1);
    expect(tagProblems({ tag: '0.6.2', version: '0.6.2' })).toHaveLength(1);
  });
});
