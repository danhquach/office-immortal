import { describe, expect, it } from 'vitest';
import type { GradeId, Item } from '../core/loot.ts';
import {
  bestGrade,
  dropToast,
  faviconHref,
  faviconSvg,
  flashes,
  higherGrade,
  immortalNotice,
  miniStatus,
  noteUnseen,
  NOTHING_UNSEEN,
  tabTitle,
} from './hud.ts';

const item = (grade: GradeId, name = 'Jade Serpent Blade'): Item => ({
  slot: 'weapon',
  name,
  level: 1,
  grade,
  baseRoll: 0.5,
  affixes: [],
});

/** The ring's drawn length over its full length, read back from the SVG. */
function ringShare(svg: string): number {
  const m = /stroke-dasharray="([\d.]+) ([\d.]+)"/.exec(svg);
  if (!m) throw new Error('no ring');
  return Number(m[1]) / Number(m[2]);
}

describe('tabTitle', () => {
  it('shows the floor and the unseen drops', () => {
    expect(tabTitle(12, 3)).toBe('F12 · 3 drops');
    expect(tabTitle(1, 1)).toBe('F1 · 1 drop');
  });

  it('shows the game name when nothing is waiting', () => {
    expect(tabTitle(12, 0)).toBe('F12 · Office Immortal');
  });
});

describe('miniStatus', () => {
  it('shows floor, realm and drops', () => {
    expect(miniStatus(21, 'Golden Core · Manager', 3)).toBe(
      'F21 · Golden Core · Manager · 3 drops',
    );
    expect(miniStatus(2, 'Qi Condensation · Intern', 1)).toBe(
      'F2 · Qi Condensation · Intern · 1 drop',
    );
    expect(miniStatus(2, 'Qi Condensation · Intern', 0)).toBe('F2 · Qi Condensation · Intern');
  });
});

describe('grades', () => {
  it('flashes on Heaven and Immortal only', () => {
    expect((['mortal', 'spirit', 'earth', 'heaven', 'immortal'] as const).map(flashes)).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it('picks the higher grade, null meaning none', () => {
    expect(higherGrade(null, null)).toBeNull();
    expect(higherGrade(null, 'spirit')).toBe('spirit');
    expect(higherGrade('heaven', null)).toBe('heaven');
    expect(higherGrade('immortal', 'heaven')).toBe('immortal');
    expect(higherGrade('earth', 'heaven')).toBe('heaven');
  });

  it('finds the best grade among drops', () => {
    expect(bestGrade([])).toBeNull();
    expect(bestGrade([item('spirit'), item('immortal'), item('earth')])).toBe('immortal');
  });
});

describe('faviconSvg', () => {
  it('draws a full ring at full HP and none at zero', () => {
    expect(ringShare(faviconSvg(1, null))).toBeCloseTo(1, 2);
    expect(ringShare(faviconSvg(0, null))).toBe(0);
  });

  it('moves in 5% steps, rounding up so a sliver of HP still shows', () => {
    expect(ringShare(faviconSvg(0.5, null))).toBeCloseTo(0.5, 2);
    expect(ringShare(faviconSvg(0.51, null))).toBeCloseTo(0.55, 2);
    expect(ringShare(faviconSvg(0.001, null))).toBeCloseTo(0.05, 2);
    expect(faviconSvg(0.52, null)).toBe(faviconSvg(0.54, null));
  });

  it('clamps out-of-range and non-finite HP', () => {
    expect(faviconSvg(2, null)).toBe(faviconSvg(1, null));
    expect(faviconSvg(-1, null)).toBe(faviconSvg(0, null));
    expect(faviconSvg(Number.NaN, null)).toBe(faviconSvg(0, null));
    expect(faviconSvg(Infinity, null)).toBe(faviconSvg(0, null));
  });

  it('turns red at low HP', () => {
    expect(faviconSvg(0.2, null)).toContain('#e0533d');
    expect(faviconSvg(0.8, null)).not.toContain('#e0533d');
  });

  it('adds a dot for a Heaven or Immortal mark only', () => {
    const plain = faviconSvg(1, null);
    expect(faviconSvg(1, 'heaven')).toContain('#e8bb2a');
    expect(faviconSvg(1, 'immortal')).toContain('#e0233f');
    expect(faviconSvg(1, 'earth')).toBe(plain);
    expect(faviconSvg(1, 'mortal')).toBe(plain);
  });

  it('ignores grades that are not real, even object built-ins', () => {
    const plain = faviconSvg(0.5, null);
    for (const bogus of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const svg = faviconSvg(0.5, bogus as GradeId);
      expect(svg).toBe(plain);
      expect(svg).not.toContain('function');
    }
  });
});

describe('faviconHref', () => {
  it('is a data URL of the encoded SVG with nothing left to break out of', () => {
    const href = faviconHref(0.5, 'heaven');
    expect(href.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(href.slice('data:image/svg+xml,'.length))).toBe(
      faviconSvg(0.5, 'heaven'),
    );
    expect(href).not.toMatch(/[<>"'\s#]/);
  });
});

describe('immortalNotice', () => {
  it('names the floor, never the item', () => {
    expect(immortalNotice(12)).toEqual({
      title: 'Office Immortal',
      body: 'Immortal-grade drop on floor 12',
    });
  });
});

describe('dropToast', () => {
  it('shows name, grade and quality', () => {
    expect(dropToast(item('earth'))).toMatch(/^Jade Serpent Blade · Earth · \d+%$/);
  });
});

describe('noteUnseen', () => {
  it('ignores drops while the tab is visible', () => {
    expect(noteUnseen(NOTHING_UNSEEN, [item('immortal')], false)).toEqual({
      unseen: NOTHING_UNSEEN,
      notify: false,
    });
  });

  it('counts hidden drops and marks only Heaven or better', () => {
    const a = noteUnseen(NOTHING_UNSEEN, [item('mortal'), item('earth')], true);
    expect(a).toEqual({ unseen: { count: 2, mark: null }, notify: false });
    const b = noteUnseen(a.unseen, [item('heaven')], true);
    expect(b).toEqual({ unseen: { count: 3, mark: 'heaven' }, notify: false });
  });

  it('keeps the best mark, and notifies only for an Immortal drop', () => {
    const imm = noteUnseen({ count: 1, mark: 'heaven' }, [item('spirit'), item('immortal')], true);
    expect(imm).toEqual({ unseen: { count: 3, mark: 'immortal' }, notify: true });
    const after = noteUnseen(imm.unseen, [item('heaven')], true);
    expect(after).toEqual({ unseen: { count: 4, mark: 'immortal' }, notify: false });
  });

  it('changes nothing for no drops', () => {
    const u = { count: 2, mark: 'heaven' as const };
    expect(noteUnseen(u, [], true)).toEqual({ unseen: u, notify: false });
  });
});
