// The browser tab as a HUD (docs/design.md §10): the tab title, the favicon's
// HP ring and its drop flash, and the pop-out's status line. Pure: numbers and
// grades in, strings out. No item names or other text from the run reach the
// title, the favicon or a notification, so nothing there can leak or inject.

import { GRADES, quality, type GradeId, type Item } from '../core/loot.ts';

export const GAME_TITLE = 'Office Immortal';

const GRADE_ORDER = Object.keys(GRADES) as GradeId[];

/** Grades that flash the favicon: Heaven and better. */
export function flashes(grade: GradeId): boolean {
  return GRADE_ORDER.indexOf(grade) >= GRADE_ORDER.indexOf('heaven');
}

/** The better of two grades; null counts as none. */
export function higherGrade(a: GradeId | null, b: GradeId | null): GradeId | null {
  if (a === null) return b;
  if (b === null) return a;
  return GRADE_ORDER.indexOf(b) > GRADE_ORDER.indexOf(a) ? b : a;
}

/** The best grade among `items`, or null for none. */
export function bestGrade(items: readonly Item[]): GradeId | null {
  return items.reduce<GradeId | null>((best, item) => higherGrade(best, item.grade), null);
}

function dropsLabel(drops: number): string {
  return drops === 1 ? '1 drop' : `${drops} drops`;
}

/** Drops kept while the tab was hidden, and the best Heaven-or-better grade among them. */
export interface Unseen {
  readonly count: number;
  readonly mark: GradeId | null;
}

export const NOTHING_UNSEEN: Unseen = { count: 0, mark: null };

/**
 * Adds `items` (just picked up) to `unseen` when the tab is hidden; a visible tab
 * shows them in the page. `notify` asks for the Immortal-drop notification.
 */
export function noteUnseen(
  unseen: Unseen,
  items: readonly Item[],
  hidden: boolean,
): { unseen: Unseen; notify: boolean } {
  if (!hidden || !items.length) return { unseen, notify: false };
  const best = bestGrade(items);
  return {
    unseen: {
      count: unseen.count + items.length,
      mark: best && flashes(best) ? higherGrade(unseen.mark, best) : unseen.mark,
    },
    notify: best === 'immortal',
  };
}

/** The tab title: `F12 · 3 drops` while drops wait unseen, else `F12 · Office Immortal`. */
export function tabTitle(floor: number, unseen: number): string {
  return `F${floor} · ${unseen > 0 ? dropsLabel(unseen) : GAME_TITLE}`;
}

/** The pop-out's status line, e.g. `F12 · Level 7 · 3 drops`; no count when nothing waits. */
export function miniStatus(floor: number, level: number, unseen: number): string {
  const head = `F${floor} · Level ${level}`;
  return unseen > 0 ? `${head} · ${dropsLabel(unseen)}` : head;
}

/** The pop-out's latest-drop toast, e.g. `Jade Stapler · Earth · 87%`. Shown on the page only, never in the title. */
export function dropToast(item: Item): string {
  return `${item.name} · ${GRADES[item.grade].name} · ${quality(item)}%`;
}

/** Favicon colours: fixed, since the tab strip is not themed by page.css. */
const RING = '#3fb56b';
const LOW = '#e0533d';
const TRACK = '#8a8f98';
const MARK: Partial<Record<GradeId, string>> = { heaven: '#e8bb2a', immortal: '#e0233f' };
/** Under this share of HP the ring turns red. */
const LOW_HP = 0.3;
/** The ring moves in 5% steps, so the icon is not rebuilt on every tick. */
const STEPS = 20;
const R = 12;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * The favicon as SVG: an HP ring (full circle at full HP, clockwise from the
 * top) and, when `mark` is set, a dot in that grade's colour.
 */
export function faviconSvg(hpShare: number, mark: GradeId | null): string {
  const share = Number.isFinite(hpShare) ? Math.min(1, Math.max(0, hpShare)) : 0;
  const step = Math.ceil(share * STEPS) / STEPS;
  const arc = (step * CIRCUMFERENCE).toFixed(2);
  const color = share < LOW_HP ? LOW : RING;
  // Own keys only, so a stray 'constructor' can never pull Object's source into the icon.
  const fill = mark && Object.hasOwn(MARK, mark) ? MARK[mark] : undefined;
  const dot = fill ? `<circle cx="16" cy="16" r="7" fill="${fill}"/>` : '';
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    `<circle cx="16" cy="16" r="${R}" fill="none" stroke="${TRACK}" stroke-opacity=".35" stroke-width="5"/>` +
    `<circle cx="16" cy="16" r="${R}" fill="none" stroke="${color}" stroke-width="5" ` +
    `stroke-dasharray="${arc} ${CIRCUMFERENCE.toFixed(2)}" transform="rotate(-90 16 16)"/>` +
    dot +
    '</svg>'
  );
}

/** The favicon as a `data:` URL for a `<link rel="icon">`. */
export function faviconHref(hpShare: number, mark: GradeId | null): string {
  return `data:image/svg+xml,${encodeURIComponent(faviconSvg(hpShare, mark))}`;
}

/** The notification for an Immortal-grade drop. Says the floor, never the item. */
export function immortalNotice(floor: number): { title: string; body: string } {
  return { title: GAME_TITLE, body: `Immortal-grade drop on floor ${floor}` };
}
