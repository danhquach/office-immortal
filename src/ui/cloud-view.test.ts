import { afterEach, describe, expect, it } from 'vitest';
import type { CloudMessage } from '../storage/cloud.ts';
import { newGame } from '../core/sim.ts';
import { decodeSave, encodeSave } from '../storage/save.ts';
import type { SyncStatus } from '../storage/sync.ts';
import { setLang, DEFAULT_LANG, PACKS } from './i18n.ts';
import {
  agoLabel,
  cloudText,
  cloudStatusLine,
  frameStep,
  linkCodeLine,
  needsChoice,
  saveSummary,
} from './cloud-view.ts';

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
      { kind: 'offline', message: 'offline' },
      { kind: 'relink' },
      { kind: 'conflict', local: save, server: save },
      { kind: 'unreadable' },
    ];
    for (const s of all) expect(cloudStatusLine(s, NOW).length).toBeGreaterThan(5);
    expect(cloudStatusLine({ kind: 'synced', at: NOW - 120_000 }, NOW)).toBe('Synced 2 min ago.');
    expect(all.filter(needsChoice).map((s) => s.kind)).toEqual(['conflict', 'unreadable']);
  });
});

describe('cloud texts in the language packs', () => {
  const CODES: CloudMessage[] = [
    'already_member',
    'not_a_member',
    'bad_data',
    'save_too_large',
    'link_code_invalid',
    'link_code_expired',
    'generic',
    'offline',
    'auth',
    'server',
    'bad-response',
    'storage',
    'loaded',
    'deleted-elsewhere',
    'unreadable-kept',
    'cant-read',
    'refused-save',
    'refused-settings',
    'relink-first',
  ];
  afterEach(() => setLang(DEFAULT_LANG));

  it('has every code and status in every pack, with the same placeholders', () => {
    const holes = (x: string): (string | undefined)[] =>
      [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const [english, ...others] = PACKS;
    for (const code of CODES) {
      const key = `cloud.msg.${code}` as const;
      expect(english?.messages[key].trim()).not.toBe('');
      for (const o of others) expect(holes(o.messages[key])).toEqual(holes(english!.messages[key]));
    }
  });

  it('words a status in the current language and again after a switch', () => {
    const status: SyncStatus = { kind: 'synced', at: NOW - 120_000 };
    expect(cloudStatusLine(status, NOW)).toBe('Synced 2 min ago.');
    setLang('vi');
    expect(cloudStatusLine(status, NOW)).toBe('Đã đồng bộ 2 phút trước.');
    expect(cloudText('link_code_expired')).not.toBe(
      'That link code has expired. Get a new one on the other device.',
    );
  });
});

describe('frameStep', () => {
  it('adds a link code frame when its part of the Menu shows and drops it when it hides', () => {
    expect(frameStep(false, true)).toBe('add');
    expect(frameStep(true, true)).toBe('keep');
    // Turned off or signed out (relink): the code frame and any code in it go.
    expect(frameStep(true, false)).toBe('drop');
    expect(frameStep(false, false)).toBe('keep');
  });
});

describe('linkCodeLine', () => {
  afterEach(() => setLang(DEFAULT_LANG));

  it('shows the code in two groups of five, spelled out for a screen reader', () => {
    expect(linkCodeLine('0D6G5S2Z8B', 900)).toEqual({
      before: 'Link code: ',
      code: '0D6G5 S2Z8B',
      spoken: '0 D 6 G 5, S 2 Z 8 B',
      after: '. Enter it on your other device within 15 minutes. It links one device.',
    });
  });

  it('puts the code where every language pack puts it, and only once', () => {
    for (const pack of PACKS) {
      setLang(pack.code);
      const line = linkCodeLine('ABCDEFGH12', 600);
      const whole = `${line.before}${line.code}${line.after}`;
      expect(whole).not.toContain('{code}');
      expect(whole).not.toContain('\u0000');
      expect(whole).toContain('10');
      expect(line.before).not.toBe('');
      expect(whole.split('ABCDE FGH12')).toHaveLength(2);
    }
  });

  it('a grouped or spoken code typed back reads as the same code', () => {
    const line = linkCodeLine('ABCDEFGH12', 900);
    expect(line.code.replace(/\s/g, '')).toBe('ABCDEFGH12');
    expect(line.spoken.replace(/[\s,]/g, '')).toBe('ABCDEFGH12');
  });
});
