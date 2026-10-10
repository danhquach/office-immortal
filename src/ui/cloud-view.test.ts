import { describe, expect, it } from 'vitest';
import { newGame } from '../core/sim.ts';
import { decodeSave, encodeSave } from '../storage/save.ts';
import type { SyncStatus } from '../storage/sync.ts';
import { agoLabel, cloudStatusLine, needsChoice, saveSummary } from './cloud-view.ts';

const NOW = 1_800_000_000_000;

describe('agoLabel', () => {
  it('reads in the largest unit that fits', () => {
    expect(agoLabel(NOW - 20_000, NOW)).toBe('just now');
    expect(agoLabel(NOW - 5 * 60_000, NOW)).toBe('5 min ago');
    expect(agoLabel(NOW - 3 * 3_600_000, NOW)).toBe('3 h ago');
    expect(agoLabel(NOW - 5 * 86_400_000, NOW)).toBe('5 days ago');
  });

  it('treats the future (a clock that is off) as just now', () => {
    expect(agoLabel(NOW + 9_999_999, NOW)).toBe('just now');
  });
});

describe('saveSummary', () => {
  it('gives realm, level, floor and when it was played', () => {
    const save = decodeSave(encodeSave(newGame(1, 'sword'), NOW - 2 * 3_600_000));
    expect(save).not.toBeNull();
    expect(saveSummary(save as NonNullable<typeof save>, NOW)).toBe(
      'Qi Condensation · Intern · Level 1 · Floor 1 · played 2 h ago',
    );
  });
});

describe('cloud status text', () => {
  it('has a plain sentence for every status', () => {
    const save = decodeSave(encodeSave(newGame(1, 'sword'), NOW)) as NonNullable<
      ReturnType<typeof decodeSave>
    >;
    const all: SyncStatus[] = [
      { kind: 'off' },
      { kind: 'checking' },
      { kind: 'syncing' },
      { kind: 'synced', at: NOW - 120_000 },
      { kind: 'offline', message: 'Cannot reach the cloud.' },
      { kind: 'relink' },
      { kind: 'conflict', local: save, server: save },
      { kind: 'unreadable' },
    ];
    for (const s of all) expect(cloudStatusLine(s, NOW).length).toBeGreaterThan(5);
    expect(cloudStatusLine({ kind: 'synced', at: NOW - 120_000 }, NOW)).toBe('Synced 2 min ago.');
    expect(all.filter(needsChoice).map((s) => s.kind)).toEqual(['conflict', 'unreadable']);
  });
});
